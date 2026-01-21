"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/Button"
import { FormError } from "@/components/ui/FormError"
import { Input } from "@/components/ui/Input"

export default function RegisterPage() {
    const router = useRouter()
    const [isLoading, setIsLoading] = React.useState<boolean>(false)
    const [error, setError] = React.useState<string | undefined>("")

    async function onSubmit(event: React.SyntheticEvent) {
        event.preventDefault()
        setIsLoading(true)
        setError(undefined)

        const target = event.target as typeof event.target & {
            username: { value: string }
            email: { value: string }
            password: { value: string }
            confirmPassword: { value: string }
        }

        const username = target.username.value
        const email = target.email.value
        const password = target.password.value
        const confirmPassword = target.confirmPassword.value

        if (!username || !email || !password || !confirmPassword) {
            setError("Please fill in all fields")
            setIsLoading(false)
            return
        }

        if (password !== confirmPassword) {
            setError("Passwords do not match")
            setIsLoading(false)
            return
        }

        setTimeout(() => {
            setIsLoading(false)
            console.log("Registered:", { username, email, password })
            router.push("/login")
        }, 1000)
    }

    return (
        <div className="container flex h-screen w-screen flex-col items-center justify-center">
            <Link
                href="/"
                className="absolute left-4 top-4 md:left-8 md:top-8 text-sm font-medium text-muted-foreground hover:text-primary"
            >
                Back
            </Link>
            <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
                <div className="flex flex-col space-y-2 text-center">
                    <h1 className="text-2xl font-semibold tracking-tight">
                        Create an account
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Enter your email below to create your account
                    </p>
                </div>
                <div className="grid gap-6">
                    <form onSubmit={onSubmit}>
                        <div className="grid gap-4">
                            <div className="grid gap-2">
                                <Input
                                    id="username"
                                    placeholder="Username"
                                    type="text"
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    disabled={isLoading}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Input
                                    id="email"
                                    placeholder="name@example.com"
                                    type="email"
                                    autoCapitalize="none"
                                    autoComplete="email"
                                    autoCorrect="off"
                                    disabled={isLoading}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Input
                                    id="password"
                                    placeholder="Password"
                                    type="password"
                                    autoCapitalize="none"
                                    autoComplete="new-password"
                                    disabled={isLoading}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Input
                                    id="confirmPassword"
                                    placeholder="Confirm Password"
                                    type="password"
                                    autoCapitalize="none"
                                    autoComplete="new-password"
                                    disabled={isLoading}
                                />
                            </div>
                            <FormError message={error} />
                            <Button disabled={isLoading} isLoading={isLoading}>
                                Sign Up with Email
                            </Button>
                        </div>
                    </form>
                    <p className="px-8 text-center text-sm text-muted-foreground">
                        Already have an account?{" "}
                        <Link
                            href="/login"
                            className="hover:text-brand underline underline-offset-4"
                        >
                            Sign In
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    )
}
