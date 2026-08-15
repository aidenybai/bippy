import { chromeDark } from "react-inspector";

import { cn } from "@/lib/utils";

const devtoolsMonoFont = "font-[SFMono-Regular,Consolas,'Liberation_Mono',Menlo,Courier,monospace]";

Object.assign(chromeDark, {
  ARROW_COLOR: "#a3a3a3",
  BASE_BACKGROUND_COLOR: "transparent",
  BASE_COLOR: "#ffffff",
  BASE_FONT_FAMILY: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace',
  BASE_FONT_SIZE: "13px",
  OBJECT_NAME_COLOR: "#ededed",
  OBJECT_VALUE_BOOLEAN_COLOR: "#d4d4d4",
  OBJECT_VALUE_FUNCTION_PREFIX_COLOR: "#61dafb",
  OBJECT_VALUE_NULL_COLOR: "#737373",
  OBJECT_VALUE_NUMBER_COLOR: "#d4d4d4",
  OBJECT_VALUE_REGEXP_COLOR: "#d4d4d4",
  OBJECT_VALUE_STRING_COLOR: "#d4d4d4",
  OBJECT_VALUE_SYMBOL_COLOR: "#d4d4d4",
  OBJECT_VALUE_UNDEFINED_COLOR: "#737373",
  TREENODE_FONT_FAMILY: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace',
  TREENODE_FONT_SIZE: "13px",
  TREENODE_LINE_HEIGHT: 1.69,
});

export const fiberTreeClassNames = {
  autoSizerWrapper: "min-h-0 w-full flex-[1_1_0] overflow-hidden focus:outline-none",
  button:
    "m-0 flex-[0_0_auto] cursor-pointer rounded border-0 bg-[#181818] p-0 text-[#b3b3b3] hover:bg-[rgba(255,255,255,0.2)] hover:text-[#ededed] active:text-[#61dafb] focus:outline-none disabled:cursor-default disabled:bg-[#181818] disabled:text-[#525252] [&:focus>span]:bg-[#333333]",
  buttonContent: "inline-flex items-center rounded p-1 focus:outline-none",
  buttonIcon: "size-4 fill-current",
  componentName: cn(
    "max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-[#61dafb]",
    devtoolsMonoFont,
  ),
  components:
    "relative flex h-80 w-full flex-row overflow-hidden rounded-lg border border-[#333333] bg-[#181818] font-sans leading-normal text-white [-webkit-font-smoothing:auto] [&_*]:box-border [&_*]:[-webkit-font-smoothing:auto] @max-[599px]:h-[420px] @max-[599px]:flex-col",
  currentHighlight: "bg-[#f7923b]",
  element: "h-[22px] text-[#61dafb] hover:bg-[rgba(255,255,255,0.1)]",
  expandCollapseToggle:
    "m-0 inline-flex size-4 flex-[0_0_1rem] items-center justify-center border-0 bg-transparent p-0 text-[#a3a3a3]",
  frame: "@container w-full",
  icon: "size-4 flex-[0_0_1rem] fill-current",
  indexInput:
    "m-0 box-content min-w-[1.5ch] rounded-sm border border-[#333333] bg-transparent px-1 py-0 text-center font-inherit text-sm text-white outline-none focus:bg-[#333333]",
  indexLabel: "whitespace-pre text-sm text-[#a3a3a3]",
  input:
    "-ml-4 w-[100px] flex-[1_1_100px] border-0 bg-[#181818] pl-6 font-sans text-base text-white outline-none placeholder:text-[#a3a3a3]",
  inputIcon: "pointer-events-none z-2 text-[#737373]",
  inspectedElement: "flex h-full min-h-0 w-full flex-col",
  inspectedElementView: cn(
    "min-h-0 flex-[1_1_0] overflow-x-hidden overflow-y-auto text-[13px] leading-[22px]",
    devtoolsMonoFont,
  ),
  inspectedElementWrapper:
    "min-h-0 min-w-0 flex-[1_1_35%] overflow-x-hidden overflow-y-auto border-l border-[#333333] @max-[599px]:flex-[1_1_50%] @max-[599px]:border-l-0",
  leftVRule: "mr-1 ml-2 h-5 w-px bg-[#333333]",
  list: cn(
    "relative h-full overflow-auto text-[13px] leading-[22px] select-none",
    devtoolsMonoFont,
  ),
  resizeBarWrapper: "relative flex-[0_0_0]",
  searchInput: "flex flex-[1_1_auto] items-center",
  selectedComponentName: "flex h-full flex-[1_1_auto] items-end overflow-hidden py-1",
  selectedElement: "bg-[#178fb9] text-white hover:bg-[#178fb9]",
  titleRow: "flex flex-[0_0_42px] items-center border-b border-[#333333] p-2 text-[17px]",
  tree: "relative flex h-full min-h-0 w-full flex-col",
  treeSearchInput: "flex flex-[0_0_42px] items-center border-b border-[#333333] p-2",
  treeWrapper: "min-h-0 min-w-0 flex-[0_0_65%] overflow-hidden @max-[599px]:flex-[0_0_50%]",
  wrapper:
    "relative inline-flex h-[22px] cursor-default items-center px-1 leading-[22px] whitespace-pre select-none",
};

export const setFiberTreeDisplayName = (component: object, displayName: string): void => {
  Reflect.set(component, "displayName", displayName);
};
