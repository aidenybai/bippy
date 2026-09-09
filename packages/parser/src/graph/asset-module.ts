import { objectFromRecord, UNDEFINED_VALUE } from "../evaluate/values.js";
import type { ImportedName, ProjectContext, StaticValue } from "../types.js";

/** Vite's `KNOWN_ASSET_TYPES`: files whose default import is the URL they are served at. */
const ASSET_PATH =
  /\.(?:apng|bmp|png|jpe?g|jfif|pjpeg|pjp|gif|svg|ico|webp|avif|cur|jxl|mp4|webm|ogg|mp3|wav|flac|aac|opus|mov|m4a|vtt|woff2?|eot|ttf|otf|webmanifest|pdf|txt)$/i;

export const isAssetPath = (filePath: string): boolean => ASSET_PATH.test(filePath);

export const getAssetModuleValue = (
  filePath: string,
  imported: ImportedName,
  project: ProjectContext,
): StaticValue => {
  const url = project.getImportedAssetUrl(filePath);
  switch (imported.kind) {
    case "default":
      return url;
    case "namespace":
      return objectFromRecord({ default: url });
    case "named":
      return imported.name === "default" ? url : UNDEFINED_VALUE;
  }
};
