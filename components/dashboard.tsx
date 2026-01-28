"use client";

import { signOut, useSession } from "next-auth/react";

export function Dashboard() {
  const { data: session } = useSession();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <p className="text-gray-600">
            Logged in as {session?.user?.name || session?.user?.email}
          </p>
        </div>
        <button
          onClick={() => signOut()}
          className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium"
        >
          Sign out
        </button>
      </div>

      <div className="bg-white rounded-lg shadow p-12 text-center">
        <p className="text-gray-600">Nothing to see here just yet.</p>
      </div>
    </div>
  );
}
