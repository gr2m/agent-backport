import { auth } from "@/lib/auth";
import { LoginButton } from "@/components/login-button";
import { Dashboard } from "@/components/dashboard";

export default async function Home() {
  const session = await auth();

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Agent Backport
          </h1>
          <p className="text-xl text-gray-600">
            AI-powered backporting of pull requests across branches
          </p>
        </div>

        {session ? (
          <Dashboard />
        ) : (
          <div className="flex flex-col items-center gap-6">
            <p className="text-gray-600">
              Sign in with GitHub to view your backport jobs
            </p>
            <LoginButton />
          </div>
        )}
      </div>
    </main>
  );
}
