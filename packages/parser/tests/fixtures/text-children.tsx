const count = 3;
const name = "world";

export default function TextChildren() {
  return (
    <div>
      <p>plain text</p>
      <p>{"single expression"}</p>
      <p>{name}</p>
      <p>{count}</p>
      <p>
        {"two"}
        {"strings"}
      </p>
      <p>
        hello {name}!
      </p>
      <p>{`template ${name}`}</p>
      <p>{count > 2 ? "many" : "few"}</p>
      <p>{0}</p>
      <p>{null}</p>
      <p>{false}</p>
      <p>{undefined}</p>
      <p>{""}</p>
      <p>
        {"a"}
        <span>b</span>
        {"c"}
      </p>
      <textarea value="ignored children" readOnly />
      <p>&amp; &lt;entities&gt; &nbsp; &#169; &#x1F600;</p>
      <p>
        multi
        line
        text
      </p>
    </div>
  );
}
