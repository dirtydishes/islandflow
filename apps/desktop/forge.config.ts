export default {
  packagerConfig: {
    appBundleId: "io.deltaisland.islandflow",
    appCategoryType: "public.app-category.finance",
    asar: true,
    executableName: "Islandflow",
    name: "Islandflow",
    ignore: [/^\/node_modules($|\/)/],
    prune: false
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"]
    }
  ]
};
