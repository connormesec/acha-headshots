import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { authApi } from "./api";
import { useAuth } from "./AuthContext";

export function Layout() {
  const { me, setMe } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const logout = async () => {
    try {
      setMe(await authApi.logout());
    } finally {
      navigate("/");
    }
  };

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead__inner">
          <Link to="/" className="brand">
            <span className="brand__mark" aria-hidden="true" />
            <span className="brand__product">ACHA Photo Tools</span>
          </Link>
          <nav className="masthead__nav" aria-label="Tools">
            <NavLink to="/headshots">Headshots</NavLink>
            <NavLink to="/jobs">Sort photos</NavLink>
            <NavLink to="/player-bg">Player page bg</NavLink>
            <NavLink to="/teams">Teams</NavLink>
            {me?.admin ? (
              <>
                <NavLink to="/admin" className="masthead__admin" title="AI help is available on your jobs">Admin</NavLink>
                <button type="button" className="masthead__link" onClick={logout}>Log out</button>
              </>
            ) : me?.loginAvailable ? (
              <NavLink to="/admin" className="masthead__link">Admin login</NavLink>
            ) : null}
          </nav>
        </div>
        {/* blue line - red center line - blue line */}
        <div className="rinklines" aria-hidden="true"><span /><span /><span /></div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
