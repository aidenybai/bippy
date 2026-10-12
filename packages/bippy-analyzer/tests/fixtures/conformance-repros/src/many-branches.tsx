export const Toolbar = ({
  ui,
}: {
  ui?: {
    f0: boolean;
    f1: boolean;
    f2: boolean;
    f3: boolean;
    f4: boolean;
    f5: boolean;
    f6: boolean;
    f7: boolean;
    f8: boolean;
    f9: boolean;
    f10: boolean;
    f11: boolean;
    f12: boolean;
    f13: boolean;
  };
}) => (
  <main>
    <section>
      <div>{ui?.f0 ? <a>f0</a> : <b>f0</b>}</div>
      <div>{ui?.f1 ? <a>f1</a> : <b>f1</b>}</div>
    </section>
    <section>
      <div>{ui?.f2 ? <a>f2</a> : <b>f2</b>}</div>
      <div>{ui?.f3 ? <a>f3</a> : <b>f3</b>}</div>
    </section>
    <section>
      <div>{ui?.f4 ? <a>f4</a> : <b>f4</b>}</div>
      <div>{ui?.f5 ? <a>f5</a> : <b>f5</b>}</div>
    </section>
    <section>
      <div>{ui?.f6 ? <a>f6</a> : <b>f6</b>}</div>
      <div>{ui?.f7 ? <a>f7</a> : <b>f7</b>}</div>
    </section>
    <section>
      <div>{ui?.f8 ? <a>f8</a> : <b>f8</b>}</div>
      <div>{ui?.f9 ? <a>f9</a> : <b>f9</b>}</div>
    </section>
    <section>
      <div>{ui?.f10 ? <a>f10</a> : <b>f10</b>}</div>
      <div>{ui?.f11 ? <a>f11</a> : <b>f11</b>}</div>
    </section>
    <section>
      <div>{ui?.f12 ? <a>f12</a> : <b>f12</b>}</div>
      <div>{ui?.f13 ? <a>f13</a> : <b>f13</b>}</div>
    </section>
  </main>
);
