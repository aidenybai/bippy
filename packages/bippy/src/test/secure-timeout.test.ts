// intentionally avoids importing ../index.js so no rdt hook is installed
import { afterEach, expect, it, vi } from "vitest";
import { INSTALL_ERROR, secure } from "../core.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("should report INSTALL_ERROR when the hook never installs in development", () => {
  vi.useFakeTimers();
  const stopMock = vi.fn();
  vi.stubGlobal("stop", stopMock);
  const onError = vi.fn();
  secure({ onActive: vi.fn() }, { installCheckTimeout: 50, onError });
  vi.advanceTimersByTime(60);
  expect(onError).toHaveBeenCalledWith(INSTALL_ERROR);
  expect(stopMock).toHaveBeenCalled();
});

it("should not report an install error in production", () => {
  vi.useFakeTimers();
  const stopMock = vi.fn();
  vi.stubGlobal("stop", stopMock);
  const onError = vi.fn();
  secure({}, { isProduction: true, onError });
  vi.advanceTimersByTime(150);
  expect(onError).not.toHaveBeenCalled();
  expect(stopMock).toHaveBeenCalled();
});
