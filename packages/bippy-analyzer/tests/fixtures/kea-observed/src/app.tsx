import { BindLogic, useActions, useValues } from "kea";
import { itemLogic } from "./item-logic";
import { userLogic } from "./user-logic";

const Item = () => {
  const { label } = useValues(itemLogic);
  return <li className="item">{label}</li>;
};

const Banner = () => <aside role="note">welcome</aside>;

export const App = () => {
  const { user, userLoading, count, isBannerVisible, greeting, isAdmin } = useValues(userLogic);
  const { increment, dismissBanner } = useActions(userLogic);
  if (userLoading) return <p className="loading">loading</p>;
  return (
    <section>
      {isBannerVisible ? <Banner /> : null}
      <h1>{greeting}</h1>
      {isAdmin ? <strong>admin</strong> : <em>member</em>}
      <button type="button" onClick={increment}>
        {count}
      </button>
      <button type="button" onClick={dismissBanner} disabled={!user}>
        dismiss
      </button>
      <ul>
        <BindLogic logic={itemLogic} props={{ id: "a" }}>
          <Item />
        </BindLogic>
        <BindLogic logic={itemLogic} props={{ id: "b" }}>
          <Item />
        </BindLogic>
      </ul>
    </section>
  );
};
