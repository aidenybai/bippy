import { Component } from "react";

interface MemberProps {
  label: string;
}

class MemberOwner extends Component {
  label = "instance";

  Leaf = ({ label }: MemberProps) => (
    <section>
      <span>{this.label}</span>
      {label}
    </section>
  );

  Views = { Leaf: this.Leaf };

  render = () => (
    <main>
      <this.Leaf label="direct" />
      <this.Views.Leaf label="nested" />
    </main>
  );
}

export const isExact = true;

export default MemberOwner;
