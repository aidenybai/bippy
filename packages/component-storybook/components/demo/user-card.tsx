interface UserCardProps {
  avatarUrl?: string;
  email: string;
  name: string;
  role?: string;
}

export const UserCard = ({
  avatarUrl,
  email,
  name,
  role = 'Member',
}: UserCardProps) => {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 text-sm font-bold text-white">
        {avatarUrl ? (
          <img alt={name} className="h-full w-full rounded-full object-cover" src={avatarUrl} />
        ) : (
          name.charAt(0).toUpperCase()
        )}
      </div>
      <div>
        <p className="text-sm font-semibold text-zinc-900">{name}</p>
        <p className="text-xs text-zinc-500">{email}</p>
        <span className="mt-0.5 inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600">
          {role}
        </span>
      </div>
    </div>
  );
};
