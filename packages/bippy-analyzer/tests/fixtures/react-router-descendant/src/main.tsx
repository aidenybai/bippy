import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useParams } from "react-router";

const EditField = () => {
  const { resource, id, field } = useParams();
  return (
    <output>
      {resource}:{id}:{field}
    </output>
  );
};

const EditOverview = () => <p>overview</p>;

const Edit = () => {
  const { id } = useParams();
  return (
    <article>
      <h2>edit {id}</h2>
      <Routes>
        <Route index element={<EditOverview />} />
        <Route path="edit/:field" element={<EditField />} />
        <Route path="*" element={<p>edit fallback</p>} />
      </Routes>
    </article>
  );
};

const List = () => <ul />;
const Create = () => <form />;
const Show = () => <pre />;

const Resource = () => (
  <Routes>
    <Route path="create/*" element={<Create />} />
    <Route path=":id/show/*" element={<Show />} />
    <Route path=":id/*" element={<Edit />} />
    <Route path="/*" element={<List />} />
  </Routes>
);

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<p>home</p>} />
      <Route path=":resource/*" element={<Resource />} />
    </Routes>
  </BrowserRouter>,
);
