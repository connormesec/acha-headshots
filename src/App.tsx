import { lazy, Suspense, type ReactNode } from "react";
import { createHashRouter, RouterProvider } from "react-router";
import { AdminLogin } from "./app/AdminLogin";
import { Home } from "./app/Home";
import { Layout } from "./app/Layout";
import { Loading } from "./components/ui";
import { HeadshotsPage } from "./features/headshots/HeadshotsPage";

// The sorting tools (and their models) only load when opened.
const pages = {
  JobList: lazy(() => import("./features/sorting/pages/JobList").then((m) => ({ default: m.JobList }))),
  NewJob: lazy(() => import("./features/sorting/pages/NewJob").then((m) => ({ default: m.NewJob }))),
  Processing: lazy(() => import("./features/sorting/pages/Processing").then((m) => ({ default: m.Processing }))),
  Results: lazy(() => import("./features/sorting/pages/Results").then((m) => ({ default: m.Results }))),
  Review: lazy(() => import("./features/sorting/pages/Review").then((m) => ({ default: m.Review }))),
  JobDetails: lazy(() => import("./features/sorting/pages/JobDetails").then((m) => ({ default: m.JobDetails }))),
  JerseyPick: lazy(() => import("./features/sorting/pages/JerseyPick").then((m) => ({ default: m.JerseyPick }))),
  PlayerBgJob: lazy(() => import("./features/playerbg/pages/PlayerBgJob").then((m) => ({ default: m.PlayerBgJob }))),
  Teams: lazy(() => import("./features/rosters/pages/Teams").then((m) => ({ default: m.Teams }))),
  AddTeam: lazy(() => import("./features/rosters/pages/AddTeam").then((m) => ({ default: m.AddTeam }))),
};
const page = (node: ReactNode) => <Suspense fallback={<Loading />}>{node}</Suspense>;

/** Hash routes (#/jobs/…): the build uses relative paths, so it works from any folder and needs no
 * server rewrite rules. */
const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: "headshots", element: <HeadshotsPage /> },
      { path: "jobs", element: page(<pages.JobList kind="sort" />) },
      { path: "jobs/new", element: page(<pages.NewJob kind="sort" />) },
      { path: "jobs/:jobId", element: page(<pages.Results />) },
      { path: "jobs/:jobId/processing", element: page(<pages.Processing />) },
      { path: "jobs/:jobId/review", element: page(<pages.Review />) },
      { path: "jobs/:jobId/jersey", element: page(<pages.JerseyPick />) },
      { path: "jobs/:jobId/details", element: page(<pages.JobDetails />) },
      { path: "player-bg", element: page(<pages.JobList kind="player_bg" />) },
      { path: "player-bg/new", element: page(<pages.NewJob kind="player_bg" />) },
      { path: "player-bg/:jobId", element: page(<pages.PlayerBgJob />) },
      { path: "teams", element: page(<pages.Teams />) },
      { path: "teams/new", element: page(<pages.AddTeam />) },
      { path: "admin", element: <AdminLogin /> },
      { path: "*", element: <div className="empty"><h2>Page not found</h2></div> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
