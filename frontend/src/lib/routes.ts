export interface NavItem {
  label: string;
  href: string;
}

export const mainNav: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Tournaments", href: "/tournaments" },
  { label: "Wallet", href: "/wallet" },
  { label: "Leaderboard", href: "/leaderboard" },
];

export const authNav = {
  authenticated: [
    { label: "Profile", href: "/profile" },
    { label: "Wallet", href: "/wallet" },
  ],
  // #326: Use the same CTA labels on desktop and mobile so the call
  // to action doesn't jump between "Register" / "Get Started" depending
  // on viewport. The primary CTA reads as "Get Started"; the route
  // stays /register because /signup doesn't exist yet.
  unauthenticated: [
    { label: "Login", href: "/login" },
    { label: "Get Started", href: "/register" },
  ],
};
