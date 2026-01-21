import Link from "next/link"
import { Button } from "@/components/ui/Button"

export default function Home() {
    return (
        <main className="flex min-h-screen flex-col items-center justify-center p-24 gap-4">
            <h1 className="text-4xl font-bold">ArenaX</h1>
            <div className="flex gap-4">
                <Link href="/login">
                    <Button>Login</Button>
                </Link>
                <Link href="/register">
                    <Button variant="outline">Register</Button>
                </Link>
            </div>
        </main>
    )
}
