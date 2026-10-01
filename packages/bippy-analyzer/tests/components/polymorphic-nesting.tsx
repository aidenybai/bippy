/**
 * A design-system primitive appears at every level of a deep tree without ever
 * rendering itself: each `Box` is created by a different owner, so the nesting
 * is not recursion. Recursion is a component in its own owner chain, which
 * `Outline` is even though a `Box` it did not create sits between the levels.
 */
import type { ReactNode } from "react";

interface BoxProps {
  as?: "div" | "span" | "ul" | "li";
  children?: ReactNode;
  level?: number;
}

const Box = ({ as: Component = "div", children, level }: BoxProps) => (
  <Component data-level={level}>{children}</Component>
);

const Frame = ({ children }: { children: ReactNode }) => <Box as="span">{children}</Box>;

interface Section {
  title: string;
  sections?: Section[];
}

const OUTLINE: Section[] = [
  { title: "one", sections: [{ title: "one.a" }, { title: "one.b", sections: [{ title: "x" }] }] },
  { title: "two" },
];

const Outline = ({ sections }: { sections: Section[] }) => (
  <Box as="ul">
    {sections.map((section) => (
      <Box key={section.title} as="li">
        {section.title}
        {section.sections ? (
          <Frame>
            <Outline sections={section.sections} />
          </Frame>
        ) : null}
      </Box>
    ))}
  </Box>
);

const Layer = ({ depth }: { depth: number }): ReactNode =>
  depth === 0 ? (
    <Box level={0}>leaf</Box>
  ) : (
    <Box level={depth}>
      <Layer depth={depth - 1} />
    </Box>
  );

const Field = ({ label }: { label: string }) => (
  <Box>
    <Box as="span">{label}</Box>
    <Box>
      <Box as="span">
        <Box>
          <Box as="span">
            <Box>
              <Box as="span">
                <Box>
                  <Box as="span">
                    <Box>
                      <Box as="span">
                        <Box>
                          <Box as="span">
                            <Box>
                              <Box as="span">
                                <Box>
                                  <Box as="span">
                                    <Box>
                                      <Box as="span">
                                        <Box>
                                          <input aria-label={label} />
                                        </Box>
                                      </Box>
                                    </Box>
                                  </Box>
                                </Box>
                              </Box>
                            </Box>
                          </Box>
                        </Box>
                      </Box>
                    </Box>
                  </Box>
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  </Box>
);

export default function PolymorphicNesting() {
  return (
    <section>
      <Outline sections={OUTLINE} />
      <Layer depth={3} />
      <Field label="name" />
    </section>
  );
}

export const isExact = true;
