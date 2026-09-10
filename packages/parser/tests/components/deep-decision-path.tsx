document.title = JSON.stringify({ isExpanded: true });

const readSettings = (): { isExpanded: boolean } => JSON.parse(document.title);

const ExpandableDetails = () => {
  const settings = readSettings();
  return settings.isExpanded ? <details open>expanded</details> : <summary>collapsed</summary>;
};

const StrongAccentLayer = () => (
  <strong>
    <ExpandableDetails />
  </strong>
);
const InlineEmphasisLayer = () => (
  <em>
    <StrongAccentLayer />
  </em>
);
const CaptionTextLayer = () => (
  <figcaption>
    <InlineEmphasisLayer />
  </figcaption>
);
const FigureFrameLayer = () => (
  <figure>
    <CaptionTextLayer />
  </figure>
);
const FooterSummaryLayer = () => (
  <footer>
    <FigureFrameLayer />
  </footer>
);
const HeaderBannerLayer = () => (
  <header>
    <FooterSummaryLayer />
  </header>
);
const ArticleContentLayer = () => (
  <article>
    <HeaderBannerLayer />
  </article>
);
const DocumentSectionLayer = () => (
  <section>
    <ArticleContentLayer />
  </section>
);
const WorkspaceContainerLayer = () => (
  <main>
    <DocumentSectionLayer />
  </main>
);
const PrimarySidebarLayer = () => (
  <aside>
    <WorkspaceContainerLayer />
  </aside>
);
const NavigationRegionLayer = () => (
  <nav>
    <PrimarySidebarLayer />
  </nav>
);
const ApplicationShellLayer = () => (
  <div>
    <NavigationRegionLayer />
  </div>
);

export const isPartial = true;

export default function DeepDecisionPath() {
  return <ApplicationShellLayer />;
}
