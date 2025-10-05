export default function Footer() {
  return (
    <footer className="border-t border-green-500/30 py-6 text-center text-gray-400 text-sm md:text-base bg-black">
      <p>© {new Date().getFullYear()} ArenaX. All rights reserved.</p>
    </footer>
  );
}
