import { Counter } from '../components/demo/counter';
import { NotificationList } from '../components/demo/notification-list';
import { Toggle } from '../components/demo/toggle';
import { UserCard } from '../components/demo/user-card';
import { StorybookPanel } from '../components/storybook-panel';

const HomePage = () => {
  return (
    <div className="min-h-screen pr-[380px]">
      <StorybookPanel />

      <div className="mx-auto max-w-2xl px-8 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-zinc-900">
            Component Storybook
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Live component inspection powered by bippy. All components on this page
            are scanned and displayed in the panel on the right.
          </p>
        </div>

        <div className="grid gap-4">
          <section>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-400">
              Interactive
            </h2>
            <div className="grid gap-3">
              <Counter label="Views" step={1} />
              <Counter initialCount={100} label="Score" step={10} />
              <Toggle label="Dark Mode" />
              <Toggle defaultEnabled label="Notifications" />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-400">
              Data Display
            </h2>
            <div className="grid gap-3">
              <UserCard
                email="alice@example.com"
                name="Alice Johnson"
                role="Admin"
              />
              <UserCard
                email="bob@example.com"
                name="Bob Smith"
              />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-400">
              Composite
            </h2>
            <NotificationList />
          </section>
        </div>
      </div>
    </div>
  );
};

export default HomePage;
