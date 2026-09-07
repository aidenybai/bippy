import { describe, expect, it } from "vite-plus/test";
import {
  getHostWorkTag,
  isDirectTextChild,
  isHostHoistableType,
  literal,
  object,
  shouldSetTextContent,
  type StaticValue,
  text,
  TRUE,
  unknown,
} from "@bippy/parser";

const props = (entries: Record<string, StaticValue>) => object(Object.entries(entries));

describe("shouldSetTextContent", () => {
  it("treats textarea and noscript children as text content", () => {
    expect(shouldSetTextContent("textarea", object())).toBe(true);
    expect(shouldSetTextContent("noscript", object())).toBe(true);
    expect(shouldSetTextContent("div", object())).toBe(false);
  });

  it("follows dangerouslySetInnerHTML.__html", () => {
    expect(
      shouldSetTextContent("div", props({ dangerouslySetInnerHTML: props({ __html: text("x") }) })),
    ).toBe(true);
    expect(
      shouldSetTextContent(
        "div",
        props({ dangerouslySetInnerHTML: props({ __html: literal(null) }) }),
      ),
    ).toBe(false);
    expect(shouldSetTextContent("div", props({ dangerouslySetInnerHTML: unknown("html") }))).toBe(
      true,
    );
  });
});

describe("isDirectTextChild", () => {
  it("accepts strings, numbers and bigints but not booleans or nullish values", () => {
    expect(isDirectTextChild(literal("a"))).toBe(true);
    expect(isDirectTextChild(literal(1))).toBe(true);
    expect(isDirectTextChild(literal(2n))).toBe(true);
    expect(isDirectTextChild(text("t"))).toBe(true);
    expect(isDirectTextChild(TRUE)).toBe(false);
    expect(isDirectTextChild(literal(null))).toBe(false);
    expect(isDirectTextChild(unknown("x"))).toBe(false);
  });
});

describe("isHostHoistableType", () => {
  it("hoists meta and title outside svg unless itemProp is set", () => {
    expect(isHostHoistableType("title", object(), false)).toBe(true);
    expect(isHostHoistableType("meta", object(), false)).toBe(true);
    expect(isHostHoistableType("title", object(), true)).toBe(false);
    expect(isHostHoistableType("meta", props({ itemProp: literal("name") }), false)).toBe(false);
  });

  it("hoists stylesheets only with a precedence and no disabled flag", () => {
    const stylesheet = { rel: literal("stylesheet"), href: literal("/a.css") };
    expect(isHostHoistableType("link", props(stylesheet), false)).toBe(false);
    expect(
      isHostHoistableType("link", props({ ...stylesheet, precedence: literal("high") }), false),
    ).toBe(true);
    expect(
      isHostHoistableType(
        "link",
        props({ ...stylesheet, precedence: literal("high"), disabled: literal(false) }),
        false,
      ),
    ).toBe(false);
    expect(
      isHostHoistableType(
        "link",
        props({ ...stylesheet, precedence: literal("high"), onLoad: unknown("fn") }),
        false,
      ),
    ).toBe(false);
  });

  it("hoists other links when rel is a known string and href is present", () => {
    expect(
      isHostHoistableType("link", props({ rel: literal("preload"), href: literal("/f") }), false),
    ).toBe(true);
    expect(isHostHoistableType("link", props({ rel: literal("preload") }), false)).toBe(false);
    expect(
      isHostHoistableType("link", props({ rel: text("rel"), href: literal("/f") }), false),
    ).toBe(false);
  });

  it("hoists async scripts with a known src and styles with href and precedence", () => {
    expect(
      isHostHoistableType("script", props({ async: TRUE, src: literal("/s.js") }), false),
    ).toBe(true);
    expect(isHostHoistableType("script", props({ src: literal("/s.js") }), false)).toBe(false);
    expect(isHostHoistableType("script", props({ async: TRUE, src: unknown("src") }), false)).toBe(
      false,
    );
    expect(
      isHostHoistableType(
        "style",
        props({ href: literal("a"), precedence: literal("default") }),
        false,
      ),
    ).toBe(true);
    expect(isHostHoistableType("style", props({ href: literal("") }), false)).toBe(false);
  });
});

describe("getHostWorkTag", () => {
  it("classifies singletons, hoistables and plain host components", () => {
    expect(getHostWorkTag("html", object(), false)).toBe("HostSingleton");
    expect(getHostWorkTag("body", object(), false)).toBe("HostSingleton");
    expect(getHostWorkTag("title", object(), false)).toBe("HostHoistable");
    expect(getHostWorkTag("div", object(), false)).toBe("HostComponent");
  });
});
