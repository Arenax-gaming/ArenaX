import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";

export default function Login() {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <Header />
      {/* login Page Content */}
      <div className="">
        <h1 className="text-3xl font-bold">Login Page</h1>
      </div>
      <Footer />
    </div>
  );
}
