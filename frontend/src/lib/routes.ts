export interface NavItem {
  label: string;
  href: string;
}

export const mainNav: NavItem[] = [
  { label: "Tournaments", href: "/tournaments" },
  { label: "Leaderboard", href: "/leaderboard" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

export const authNav = {
  authenticated: [
    { label: "Profile", href: "/profile" },
    { label: "Wallet", href: "/wallet" },
  ],
  unauthenticated: [
    { label: "Login", href: "/login" },
    { label: "Register", href: "/register" },
  ],
};
