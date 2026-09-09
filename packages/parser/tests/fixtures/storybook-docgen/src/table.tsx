import { Panel, PanelFooter } from "./panel";
import ScrollArea, { ResponsiveWrapper } from "./responsive-wrapper";

export const Table = () => (
  <ResponsiveWrapper $responsive>
    <Panel title="Rows">
      <ScrollArea $height="100vh">
        <table>
          <tbody>
            <tr>
              <td>one</td>
            </tr>
          </tbody>
        </table>
      </ScrollArea>
      <PanelFooter>1 row</PanelFooter>
    </Panel>
  </ResponsiveWrapper>
);
