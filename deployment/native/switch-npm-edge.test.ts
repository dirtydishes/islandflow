import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../..");
const scriptPath = join(import.meta.dir, "switch-npm-edge.sh");
const tempRoots: string[] = [];

const apiProxyHostConfig = (server: string): string => `server {
  set $forward_scheme http;
  set $server         "${server}";
  set $port           4000;
}
`;

const appProxyHostConfig = (webServer: string, apiServer: string): string => `server {
  set $forward_scheme http;
  set $server         "${webServer}";
  set $port           3000;

  location ~ ^/(ws|replay|prints|joins|nbbo|dark|flow|candles|history)/ {
  set $forward_scheme http;
  set $server         "${apiServer}";
  set $port           4000;
  }

  location / {
    include conf.d/include/proxy.conf;
  }
}
`;

type Fixture = {
  root: string;
  dbPath: string;
  appConf: string;
  apiConf: string;
};

const createFixture = (): Fixture => {
  const root = mkdtempSync(join(tmpdir(), "islandflow-npm-edge-"));
  tempRoots.push(root);
  const proxyDir = join(root, "data/nginx/proxy_host");
  mkdirSync(proxyDir, { recursive: true });

  const dbPath = join(root, "data/database.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    create table proxy_host (
      id integer primary key,
      domain_names text not null,
      is_deleted integer not null default 0,
      forward_scheme text not null default 'http',
      forward_host text not null,
      forward_port integer not null,
      allow_websocket_upgrade integer not null default 0,
      advanced_config text not null default '',
      enabled integer not null default 1,
      modified_on text
    );
  `);
  db.query(
    "insert into proxy_host (id, domain_names, forward_host, forward_port, allow_websocket_upgrade, enabled) values (?, ?, ?, ?, ?, ?)"
  ).run(1, JSON.stringify(["app.example.test"]), "old-web", 3000, 1, 1);
  db.query(
    "insert into proxy_host (id, domain_names, forward_host, forward_port, allow_websocket_upgrade, enabled) values (?, ?, ?, ?, ?, ?)"
  ).run(2, JSON.stringify(["api.example.test"]), "old-api", 4000, 1, 1);
  db.close();

  const appConf = join(proxyDir, "1.conf");
  const apiConf = join(proxyDir, "2.conf");
  writeFileSync(appConf, appProxyHostConfig("old-web", "old-api"));
  writeFileSync(apiConf, apiProxyHostConfig("old-api"));

  return { root, dbPath, appConf, apiConf };
};

const runSwitch = (fixture: Fixture, args: string[], env: Record<string, string> = {}) => {
  const result = Bun.spawnSync({
    cmd: ["bash", scriptPath, ...args],
    cwd: repoRoot,
    env: {
      ...process.env,
      NPM_ROOT: fixture.root,
      NPM_DB_PATH: fixture.dbPath,
      NPM_RESTART: "0",
      ISLANDFLOW_APP_DOMAIN: "app.example.test",
      ISLANDFLOW_API_DOMAIN: "api.example.test",
      ...env
    },
    stdout: "pipe",
    stderr: "pipe"
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `switch-npm-edge failed\nstdout:\n${result.stdout.toString()}\nstderr:\n${result.stderr.toString()}`
    );
  }

  return result.stdout.toString();
};

const readProxyHost = (dbPath: string, id: number) => {
  const db = new Database(dbPath, { readonly: true });
  const row = db
    .query(
      "select forward_host, forward_port, allow_websocket_upgrade, advanced_config, enabled from proxy_host where id = ?"
    )
    .get(id) as {
    forward_host: string;
    forward_port: number;
    allow_websocket_upgrade: number;
    advanced_config: string;
    enabled: number;
  };
  db.close();
  return row;
};

describe("switch-npm-edge raw API host posture", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("keeps the raw API host closed by default while preserving app-origin routing", () => {
    const fixture = createFixture();

    const output = runSwitch(fixture, ["docker"]);

    const app = readProxyHost(fixture.dbPath, 1);
    expect(app.forward_host).toBe("web");
    expect(app.forward_port).toBe(3000);
    expect(app.enabled).toBe(1);
    expect(app.allow_websocket_upgrade).toBe(1);
    expect(app.advanced_config).toContain("^/(ws|replay|prints|joins|nbbo|quotes|dark|flow|candles|history|news|lookup|option-prints|equity-joins)(/|$)");
    expect(app.advanced_config).toContain('set $server         "api";');

    const api = readProxyHost(fixture.dbPath, 2);
    expect(api.enabled).toBe(0);
    expect(api.allow_websocket_upgrade).toBe(0);
    expect(api.forward_host).toBe("127.0.0.1");
    expect(api.forward_port).toBe(9);
    expect(api.advanced_config).toBe("");
    expect(existsSync(fixture.apiConf)).toBe(false);
    expect(readFileSync(fixture.appConf, "utf8")).toContain(
      "^/(ws|replay|prints|joins|nbbo|quotes|dark|flow|candles|history|news|lookup|option-prints|equity-joins)(/|$)"
    );
    expect(output).toContain("public raw API forwarding is disabled");
  });

  it("requires an explicit temporary-open mode to restore raw API forwarding", () => {
    const fixture = createFixture();

    const output = runSwitch(fixture, ["native", "--raw-api=temporary-open"], {
      ISLANDFLOW_NATIVE_HOST: "172.18.0.1"
    });

    const app = readProxyHost(fixture.dbPath, 1);
    expect(app.forward_host).toBe("172.18.0.1");
    expect(app.advanced_config).toContain('set $server         "172.18.0.1";');

    const api = readProxyHost(fixture.dbPath, 2);
    expect(api.enabled).toBe(1);
    expect(api.allow_websocket_upgrade).toBe(1);
    expect(api.forward_host).toBe("172.18.0.1");
    expect(api.forward_port).toBe(4000);
    expect(existsSync(fixture.apiConf)).toBe(true);
    expect(readFileSync(fixture.apiConf, "utf8")).toContain('set $server         "172.18.0.1";');
    expect(output).toContain("Temporarily opened");
  });
});
