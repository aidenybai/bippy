import * as React from "react";

interface MenuContextValue {
  isOpen: boolean;
  inNavbar: boolean;
}

const MenuContext = React.createContext<MenuContextValue>({ isOpen: false, inNavbar: false });

class Toggle extends React.Component<{ label: string }> {
  static contextType = MenuContext;
  declare context: MenuContextValue;

  render() {
    return (
      <button aria-expanded={this.context.isOpen}>
        {this.context.inNavbar ? <i>{this.props.label}</i> : this.props.label}
      </button>
    );
  }
}

class Menu extends React.Component<{ children: React.ReactNode }> {
  declare context: MenuContextValue;

  constructor(props: { children: React.ReactNode }, context: MenuContextValue) {
    super(props, context);
    this.state = { openedInNavbar: context.inNavbar };
  }

  render() {
    return this.context.isOpen ? <ul>{this.props.children}</ul> : <p>closed</p>;
  }
}

Menu.contextType = MenuContext;

class Plain extends React.Component {
  render() {
    return <code>{Object.keys(this.context).length}</code>;
  }
}

export const isExact = true;

export default function ClassContextType() {
  return (
    <div>
      <MenuContext.Provider value={{ isOpen: true, inNavbar: true }}>
        <Toggle label="navbar" />
        <Menu>
          <li>one</li>
        </Menu>
      </MenuContext.Provider>
      <Toggle label="default" />
      <Menu>
        <li>two</li>
      </Menu>
      <Plain />
    </div>
  );
}
