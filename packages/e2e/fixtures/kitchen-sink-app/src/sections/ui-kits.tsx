import { Button as MantineButton, MantineProvider } from "@mantine/core";
import MuiButton from "@mui/material/Button";
import MuiSlider from "@mui/material/Slider";
import { Button as AntdButton, Tag as AntdTag } from "antd";
import { useState } from "react";
import BootstrapButton from "react-bootstrap/Button";

import type { LibrarySection } from "../section-registry";

const MuiSection = () => {
  const [clickCount, setClickCount] = useState(0);
  return (
    <div>
      <MuiButton
        data-testid="interact-mui"
        variant="contained"
        onClick={() => setClickCount((previous) => previous + 1)}
      >
        mui:{clickCount}
      </MuiButton>
      <MuiSlider aria-label="volume" defaultValue={30} sx={{ width: 100 }} />
    </div>
  );
};

const MantineSection = () => {
  const [clickCount, setClickCount] = useState(0);
  return (
    <MantineProvider>
      <MantineButton
        data-testid="interact-mantine"
        onClick={() => setClickCount((previous) => previous + 1)}
      >
        mantine:{clickCount}
      </MantineButton>
    </MantineProvider>
  );
};

const AntdSection = () => {
  const [clickCount, setClickCount] = useState(0);
  return (
    <div>
      <AntdButton
        data-testid="interact-antd"
        type="primary"
        onClick={() => setClickCount((previous) => previous + 1)}
      >
        antd:{clickCount}
      </AntdButton>
      <AntdTag color="blue">tag</AntdTag>
    </div>
  );
};

const BootstrapSection = () => {
  const [clickCount, setClickCount] = useState(0);
  return (
    <BootstrapButton
      data-testid="interact-bootstrap"
      onClick={() => setClickCount((previous) => previous + 1)}
    >
      bootstrap:{clickCount}
    </BootstrapButton>
  );
};

export const uiKitSections: LibrarySection[] = [
  { name: "mui", Component: MuiSection },
  { name: "mantine", Component: MantineSection },
  { name: "antd", Component: AntdSection },
  { name: "react-bootstrap", Component: BootstrapSection },
];
