import { chromeDark } from "react-inspector";

import { cn } from "@/lib/utils";

const devtoolsMonoFont = "font-[SFMono-Regular,Consolas,'Liberation_Mono',Menlo,Courier,monospace]";
const devtoolsScrollArea =
  "[scrollbar-color:#60646c_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:size-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#60646c] hover:[&::-webkit-scrollbar-thumb]:bg-[#777d88]";

Object.assign(chromeDark, {
  ARROW_COLOR: "#8f949d",
  BASE_BACKGROUND_COLOR: "transparent",
  BASE_COLOR: "#ffffff",
  BASE_FONT_FAMILY: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace',
  BASE_FONT_SIZE: "13px",
  OBJECT_NAME_COLOR: "#ededed",
  OBJECT_VALUE_BOOLEAN_COLOR: "#cedae0",
  OBJECT_VALUE_FUNCTION_PREFIX_COLOR: "#61dafb",
  OBJECT_VALUE_NULL_COLOR: "#777d88",
  OBJECT_VALUE_NUMBER_COLOR: "#cedae0",
  OBJECT_VALUE_REGEXP_COLOR: "#cedae0",
  OBJECT_VALUE_STRING_COLOR: "#cedae0",
  OBJECT_VALUE_SYMBOL_COLOR: "#cedae0",
  OBJECT_VALUE_UNDEFINED_COLOR: "#777d88",
  TREENODE_FONT_FAMILY: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace',
  TREENODE_FONT_SIZE: "13px",
  TREENODE_LINE_HEIGHT: 1.69,
});

export const fiberTreeClassNames = {
  autoSizerWrapper: "min-h-0 w-full flex-[1_1_0] overflow-hidden focus:outline-none",
  button:
    "m-0 flex-[0_0_auto] cursor-pointer rounded border-0 bg-[#1b1d23] p-0 text-[#afb3b9] hover:bg-[rgba(255,255,255,0.2)] hover:text-[#ededed] active:text-[#61dafb] focus:outline-none disabled:cursor-default disabled:bg-[#1b1d23] disabled:text-[#4f5766] [&:focus>span]:bg-[#30343c]",
  buttonContent: "inline-flex items-center rounded p-1 focus:outline-none",
  buttonIcon: "size-4 fill-current",
  componentName: cn(
    "max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-[#61dafb]",
    devtoolsMonoFont,
  ),
  components:
    "relative flex h-80 w-full flex-row overflow-hidden rounded-lg border border-[#30343c] bg-[#1b1d23] font-sans leading-normal text-white [-webkit-font-smoothing:auto] [&_*]:box-border [&_*]:[-webkit-font-smoothing:auto] @max-[599px]:h-[420px] @max-[599px]:flex-col",
  currentHighlight: "bg-[#f7923b]",
  element: "h-[22px] text-[#61dafb] hover:bg-[rgba(255,255,255,0.1)]",
  expandCollapseToggle:
    "m-0 inline-flex size-4 flex-[0_0_1rem] items-center justify-center border-0 bg-transparent p-0 text-[#8f949d]",
  frame: "@container w-full",
  icon: "size-4 flex-[0_0_1rem] fill-current",
  indexInput:
    "m-0 box-content min-w-[1.5ch] rounded-sm border border-[#30343c] bg-transparent px-1 py-0 text-center font-inherit text-sm text-white outline-none focus:bg-[#30343c]",
  indexLabel: "whitespace-pre text-sm text-[#8f949d]",
  input:
    "-ml-4 w-[100px] flex-[1_1_100px] border-0 bg-[#1b1d23] pl-6 font-sans text-base text-white outline-none placeholder:text-[#8f949d]",
  inputIcon: "pointer-events-none z-2 text-[#777d88]",
  inspectedElement: "flex h-full min-h-0 w-full flex-col",
  inspectedElementView: cn(
    "min-h-0 flex-[1_1_0] overflow-x-hidden overflow-y-auto text-[13px] leading-[22px]",
    devtoolsMonoFont,
    devtoolsScrollArea,
  ),
  inspectedElementWrapper:
    "min-h-0 min-w-0 flex-[1_1_35%] overflow-hidden border-l border-[#30343c] @max-[599px]:flex-[1_1_50%] @max-[599px]:border-l-0",
  leftVRule: "mr-1 ml-2 h-5 w-px bg-[#30343c]",
  list: cn(
    "relative h-full overflow-x-hidden overflow-y-auto text-[13px] leading-[22px] select-none",
    devtoolsMonoFont,
    devtoolsScrollArea,
  ),
  resizeBarWrapper: "relative flex-[0_0_0]",
  searchInput: "flex flex-[1_1_auto] items-center",
  selectedComponentName: "flex h-full flex-[1_1_auto] items-end overflow-hidden py-1",
  selectedElement: "bg-[#178fb9] text-white hover:bg-[#178fb9]",
  titleRow: "flex flex-[0_0_42px] items-center border-b border-[#30343c] p-2 text-[17px]",
  tree: "relative flex h-full min-h-0 w-full flex-col",
  treeSearchInput: "flex flex-[0_0_42px] items-center border-b border-[#30343c] p-2",
  treeWrapper: "min-h-0 min-w-0 flex-[0_0_65%] overflow-hidden @max-[599px]:flex-[0_0_50%]",
  wrapper:
    "relative inline-flex h-[22px] cursor-default items-center px-1 leading-[22px] whitespace-pre select-none",
};

export const setFiberTreeDisplayName = (component: object, displayName: string): void => {
  Reflect.set(component, "displayName", displayName);
};
