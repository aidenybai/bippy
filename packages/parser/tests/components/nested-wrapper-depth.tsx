import { forwardRef, type ReactNode } from "react";

const Box = forwardRef<HTMLDivElement, { children?: ReactNode; level?: number }>(
  ({ children, level }, ref) => (
    <div ref={ref} data-level={level}>
      {children}
    </div>
  ),
);

const Wrap = ({ children }: { children: ReactNode }) => <Box>{children}</Box>;

const Stack = ({ children }: { children: ReactNode }) => (
  <Box level={0}>
    <Box level={1}>
      <Box level={2}>
        <Box level={3}>
          <Box level={4}>
            <Box level={5}>
              <Box level={6}>
                <Box level={7}>
                  <Box level={8}>
                    <Box level={9}>
                      <Box level={10}>
                        <Box level={11}>
                          <Box level={12}>
                            <Box level={13}>
                              <Box level={14}>
                                <Box level={15}>
                                  <Box level={16}>
                                    <Box level={17}>{children}</Box>
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

export default function NestedWrapperDepth() {
  return (
    <section>
      <Stack>
        <Wrap>
          <Wrap>
            <Wrap>
              <output>deep</output>
            </Wrap>
          </Wrap>
        </Wrap>
      </Stack>
    </section>
  );
}
