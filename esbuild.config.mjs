import esbuild from "esbuild";
import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers";

const presets = createPluginBundlerPresets({ uiEntry: "src/ui/index.tsx" });
const watch = process.argv.includes("--watch");
const manifestBuild = {
  ...presets.esbuild.manifest,
  bundle: true,
};

const workerCtx = await esbuild.context(presets.esbuild.worker);
const manifestCtx = await esbuild.context(manifestBuild);
const uiCtx = await esbuild.context(presets.esbuild.ui);
const adapterCtx = await esbuild.context({
  entryPoints: ["src/adapter-service.ts"],
  outfile: "dist/adapter-service.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
});

if (watch) {
  await Promise.all([workerCtx.watch(), manifestCtx.watch(), uiCtx.watch(), adapterCtx.watch()]);
  console.log("esbuild watch mode enabled for worker, manifest, ui, and adapter service");
} else {
  await Promise.all([workerCtx.rebuild(), manifestCtx.rebuild(), uiCtx.rebuild(), adapterCtx.rebuild()]);
  await Promise.all([workerCtx.dispose(), manifestCtx.dispose(), uiCtx.dispose(), adapterCtx.dispose()]);
}
