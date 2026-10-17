import { createHashRouter, RouterProvider } from "react-router";
import { AdminLogin } from "./app/AdminLogin";
import { Home } from "./app/Home";
import { Layout } from "./app/Layout";
import { HeadshotsPage } from "./features/headshots/HeadshotsPage";

/** Hash routes (#/jobs/…): the build uses relative paths, so it works from any folder and needs no
 * server rewrite rules. */
const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: "headshots", element: <HeadshotsPage /> },
      { path: "admin", element: <AdminLogin /> },
      { path: "*", element: <div className="empty"><h2>Page not found</h2></div> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
