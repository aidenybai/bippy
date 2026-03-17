import { by, device, element, expect } from 'detox';

describe('bippy source functions on React Native (Metro)', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
    await waitFor(element(by.id('results-container')))
      .toBeVisible()
      .withTimeout(15_000);
    // HACK: source tests are async, wait for results to populate
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  });

  describe('getSource', () => {
    it('returns a fileName for TestChild fiber', async () => {
      const attributes = await element(by.id('result-source-fileName')).getAttributes();
      const fileName = (attributes as any).text;
      expect(fileName).not.toBe('null');
      expect(fileName).not.toBe('error');
      expect(fileName.length).toBeGreaterThan(0);
    });

    it('returns a positive lineNumber for TestChild fiber', async () => {
      const attributes = await element(by.id('result-source-lineNumber')).getAttributes();
      const lineNumber = (attributes as any).text;
      expect(lineNumber).not.toBe('null');
      expect(lineNumber).not.toBe('error');
      const parsed = parseInt(lineNumber, 10);
      expect(parsed).toBeGreaterThan(0);
    });

    it('returns a columnNumber for TestChild fiber', async () => {
      const attributes = await element(by.id('result-source-columnNumber')).getAttributes();
      const columnNumber = (attributes as any).text;
      expect(columnNumber).not.toBe('null');
      expect(columnNumber).not.toBe('error');
    });
  });

  describe('getOwnerStack', () => {
    it('returns a non-empty owner stack', async () => {
      const attributes = await element(by.id('result-ownerStack-length')).getAttributes();
      const length = (attributes as any).text;
      expect(length).not.toBe('error');
      const parsed = parseInt(length, 10);
      expect(parsed).toBeGreaterThan(0);
    });

    it('owner stack contains TestChild function name', async () => {
      const attributes = await element(by.id('result-ownerStack-names')).getAttributes();
      const names = (attributes as any).text;
      expect(names).not.toBe('error');
      expect(names).toContain('TestChild');
    });

    it('owner stack contains TestParent function name', async () => {
      const attributes = await element(by.id('result-ownerStack-names')).getAttributes();
      const names = (attributes as any).text;
      expect(names).not.toBe('error');
      expect(names).toContain('TestParent');
    });
  });

  describe('getDisplayNameFromSource', () => {
    it('returns a non-null display name', async () => {
      const attributes = await element(
        by.id('result-displayNameFromSource'),
      ).getAttributes();
      const displayName = (attributes as any).text;
      expect(displayName).not.toBe('null');
      expect(displayName).not.toBe('error');
      expect(displayName.length).toBeGreaterThan(0);
    });
  });

  describe('parent source resolution', () => {
    it('getSource returns a fileName for TestParent', async () => {
      const attributes = await element(
        by.id('result-parentSource-fileName'),
      ).getAttributes();
      const fileName = (attributes as any).text;
      expect(fileName).not.toBe('error');
    });

    it('getOwnerStack returns frames for TestParent', async () => {
      const attributes = await element(
        by.id('result-parentOwnerStack-length'),
      ).getAttributes();
      const length = (attributes as any).text;
      expect(length).not.toBe('error');
      const parsed = parseInt(length, 10);
      expect(parsed).toBeGreaterThan(0);
    });
  });
});
