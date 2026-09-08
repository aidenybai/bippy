import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import AppBar from "@mui/material/AppBar";
import Avatar from "@mui/material/Avatar";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import CssBaseline from "@mui/material/CssBaseline";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import SvgIcon from "@mui/material/SvgIcon";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { createTheme, styled, ThemeProvider, useTheme } from "@mui/material/styles";
import { useFormControl } from "@mui/material/FormControl";

const theme = createTheme({
  palette: {
    primary: { main: "#1a73e8" },
    secondary: { main: "#d93025" },
  },
});

const Panel = styled("section")(({ theme: current }) => ({
  padding: current.spacing(2),
  color: current.palette.primary.main,
  border: `1px solid ${current.palette.divider}`,
}));

const Label = styled(Typography)`
  font-weight: 700;
`;

const Viewport = () => {
  const current = useTheme();
  const isWide = useMediaQuery(current.breakpoints.up("md"));
  return <Typography variant="caption">{isWide ? "wide" : "narrow"}</Typography>;
};

const FieldState = () => {
  const control = useFormControl();
  return <span data-filled={control?.filled ? "yes" : "no"} />;
};

const CloseIcon = () => (
  <SvgIcon>
    <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </SvgIcon>
);

const rows = [
  { id: 1, name: "Ada", role: "admin" },
  { id: 2, name: "Grace", role: "editor" },
];

const Shell = () => (
  <>
    <AppBar position="static">
      <Toolbar variant="dense">
        <IconButton edge="start" color="inherit">
          <Badge badgeContent={4} color="secondary">
            <CloseIcon />
          </Badge>
        </IconButton>
        <Typography variant="h6">Admin</Typography>
        <Avatar>AB</Avatar>
      </Toolbar>
    </AppBar>
    <Drawer variant="permanent" open>
      <List dense>
        <ListItemButton selected>
          <ListItemIcon>
            <CloseIcon />
          </ListItemIcon>
          <ListItemText primary="Users" secondary="2 rows" />
        </ListItemButton>
        <ListItemButton>
          <ListItemText primary="Settings" />
        </ListItemButton>
      </List>
    </Drawer>
    <Tabs value={0}>
      <Tab label="One" />
      <Tab label="Two" />
    </Tabs>
    <Card>
      <CardContent>
        <Alert severity="info">Read only</Alert>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell align="right">Role</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.name}</TableCell>
                <TableCell align="right">
                  <Switch size="small" checked={row.role === "admin"} readOnly />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <CircularProgress size={16} />
      </CardContent>
    </Card>
    <Accordion>
      <AccordionSummary>Details</AccordionSummary>
      <AccordionDetails>Hidden until expanded</AccordionDetails>
    </Accordion>
    <FormControl size="small">
      <InputLabel id="role-label">Role</InputLabel>
      <Select labelId="role-label" label="Role" value="admin">
        <MenuItem value="admin">Admin</MenuItem>
        <MenuItem value="editor">Editor</MenuItem>
      </Select>
    </FormControl>
    <Snackbar open={false} message="Saved" />
  </>
);

export const App = () => (
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <Shell />
    <Panel>
      <Typography variant="h5" component="h1">
        Settings
      </Typography>
      <Stack direction="row" spacing={2} divider={<Divider orientation="vertical" flexItem />}>
        <Button variant="contained">Save</Button>
        <Button variant="outlined" color="secondary">
          Cancel
        </Button>
        <Tooltip title="Close">
          <IconButton aria-label="close" size="small">
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </Stack>
      <Box sx={{ mt: 2, display: "flex", gap: 1 }}>
        <Label variant="body2">badge</Label>
        <Viewport />
        <Chip label="beta" color="primary" size="small" />
      </Box>
      <Paper
        elevation={3}
        sx={(current) => ({ p: current.spacing(1), bgcolor: "background.paper" })}
      >
        <FormControlLabel control={<Checkbox defaultChecked />} label="Notify" />
      </Paper>
      <Dialog open={false}>
        <DialogTitle>Closed</DialogTitle>
      </Dialog>
      <Menu open={false}>
        <MenuItem>Item</MenuItem>
      </Menu>
      <TextField label="Name" defaultValue="Ada" helperText="Required" />
      <TextField label="Notes" InputProps={{ endAdornment: <FieldState /> }} />
    </Panel>
  </ThemeProvider>
);
