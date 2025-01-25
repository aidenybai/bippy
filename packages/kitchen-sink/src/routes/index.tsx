import { createFileRoute } from '@tanstack/react-router';
import { useState, type ReactNode, Fragment } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { highlight } from 'sugar-high';

declare const __VERSION__: string;

interface TextProps {
  as?: keyof JSX.IntrinsicElements;
  children: ReactNode;
  className?: string;
}

interface LinkProps {
  children: ReactNode;
  className?: string;
  href?: string;
  onClick?: () => void;
}

interface ListProps {
  children: ReactNode;
  className?: string;
}

interface ListItemProps {
  children: ReactNode;
}

interface SideLayoutProps {
  children: ReactNode;
}

interface TabsProps<T extends string> {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

function Tabs<T extends string>({ tabs, value, onChange }: TabsProps<T>) {
  return (
    <div className="flex items-center gap-2">
      {tabs.map((tab, i) => (
        <Fragment key={tab.value}>
          {i > 0 && <span className="text-white/40">·</span>}
          <button
            type="button"
            onClick={() => onChange(tab.value)}
            className={cn(
              'text-white/70 hover:text-white underline transition-colors',
              value === tab.value && 'text-white',
            )}
          >
            {tab.label}
          </button>
        </Fragment>
      ))}
    </div>
  );
}

export function cn(...inputs: (string | undefined | boolean)[]) {
  return twMerge(clsx(inputs));
}

function SideLayout({ children }: SideLayoutProps) {
  return (
    <div className="relative leading-normal pl-[2ch] pt-[1lh] pr-[2ch] sm:pt-[2lh] sm:pl-[7ch] min-h-[100dvh] pb-[1lh] sm:max-w-[80ch] text-white">
      {children}
    </div>
  );
}

function Text({
  as: Component = 'p',
  children,
  className,
  ...props
}: TextProps) {
  return (
    <Component className={cn('text-lg', className)} {...props}>
      {children}
    </Component>
  );
}

function Link({ children, className, href, onClick, ...props }: LinkProps) {
  return (
    <a
      href={href}
      onClick={onClick}
      className={cn('underline hover:bg-black hover:text-white', className)}
      {...props}
    >
      {children}
    </a>
  );
}

function List({ children, className }: ListProps) {
  return (
    <ul
      className={cn(
        "pl-[2ch] list-disc marker:content-['→'] marker:text-neutral-400 marker:pr-[1ch] space-y-[1ch]",
        className,
      )}
    >
      {children}
    </ul>
  );
}

function ListItem({ children }: ListItemProps) {
  return <li className="pl-[1ch]">{children}</li>;
}

export default function Main() {
  const [imgSize, setImgSize] = useState(50);
  const [isSpinning, setIsSpinning] = useState(false);
  const [activeTab, setActiveTab] = useState<'basic' | 'inspect'>('basic');

  const tabs = [
    { value: 'basic' as const, label: '1. quick start' },
    { value: 'inspect' as const, label: '2. use <Inspector>' },
  ];

  return (
    <div className="bg-[#101010]">
      <SideLayout>
        <div className="flex items-center gap-[1ch]">
          <div className="flex items-center gap-[0.5ch]">
            <img
              src="/bippy.png"
              alt="bippy logo"
              className={cn('select-none', isSpinning && 'animate-spin')}
              width={imgSize}
              height={imgSize}
              onClick={() => setImgSize(imgSize + 10)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setImgSize(imgSize + 10);
                }
              }}
              onMouseEnter={() => setIsSpinning(true)}
              onMouseLeave={() => setIsSpinning(false)}
            />
            <Text className="font-bold text-2xl" as="h1">
              bippy
            </Text>
          </div>
          <Link
            href="https://github.com/aidenybai/bippy"
            className="hidden sm:flex"
          >
            <Text as="span">{__VERSION__}</Text>
          </Link>
          <div className="ml-auto flex gap-[1ch] my-[1ch]">
            <Text className="text-muted-foreground">
              <Link href="https://github.com/aidenybai/bippy">/github</Link>
            </Text>
          </div>
        </div>

        <hr className="my-[1ch] border-white/10" />

        <div className="flex flex-col gap-[1ch] my-[2ch]">
          <Text className="text-muted-foreground">
            bippy is a toolkit to{' '}
            <Text as="span" className="font-bold">
              hack into react internals
            </Text>
          </Text>
        </div>

        <div className="flex flex-col gap-[1ch] my-[2ch]">
          <Text className="text-muted-foreground">
            by default, you cannot access react internals. bippy bypasses this
            by "pretending" to be react devtools, giving you access to the fiber
            tree and other internals.
          </Text>
        </div>

        <List className="my-[2ch]">
          <ListItem>
            <Text className="text-muted-foreground">
              works outside of react – no react code modification needed
            </Text>
          </ListItem>
          <ListItem>
            <Text className="text-muted-foreground">
              utility functions that work across modern react (v17-19)
            </Text>
          </ListItem>
          <ListItem>
            <Text className="text-muted-foreground">
              no prior react source code knowledge required
            </Text>
          </ListItem>
        </List>

        <div className="flex flex-col gap-[1ch] my-[1ch]">
          <Text className="text-muted-foreground">
            you can get started in {'<'}6 lines of code:
          </Text>
        </div>

        <pre className="bg-[#101010] mt-[2ch] p-[1.5ch] pt-[1ch] sm:p-[2ch] sm:pt-[1.5ch] rounded-lg border border-white/10">
          <div className="mb-[1.5ch]">
            <Tabs tabs={tabs} value={activeTab} onChange={setActiveTab} />
            <hr className="my-[1ch] border-neutral-700" />
          </div>
          {activeTab === 'basic' && (
            <code
              className="whitespace-pre-wrap"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: OK
              dangerouslySetInnerHTML={{
                __html:
                  highlight(`import { onCommitFiberRoot, traverseFiber } from 'bippy';

onCommitFiberRoot((root) => {
  traverseFiber(root.current, (fiber) => {
    console.log('fiber:', fiber);
  });
})`),
              }}
            />
          )}
          {activeTab === 'inspect' && (
            <code
              className="whitespace-pre-wrap"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: OK
              dangerouslySetInnerHTML={{
                __html: highlight(`import { Inspector } from 'bippy/experiments/inspect';

<Inspector enabled={true} />`),
              }}
            />
          )}
        </pre>

        <div className="flex my-[2ch]">
          <a href="https://github.com/aidenybai/bippy">
            <button
              type="button"
              className="bg-white text-black px-[1ch] py-[0.5ch] rounded-sm hover:bg-white/90 transition-all duration-150 font-bold text-lg"
            >
              try bippy →
            </button>
          </a>
        </div>

        <div className="bg-[#eda33b]/25 text-white p-[1ch] my-[2ch] font-sans">
          <div>
            <Text className="text-xs">
              <Text as="span" className="text-xs font-bold">
                ⚠️ warning:{' '}
              </Text>
              <Text as="span" className="text-xs">
                this project may break production apps and cause unexpected
                behavior
              </Text>
            </Text>
          </div>
          <div className="mt-[1ch]">
            <Text className="text-xs">
              this project uses react internals, which can change at any time.
              it is not recommended to depend on internals unless you really,{' '}
              <Text as="span" className="text-xs italic">
                really have to.
              </Text>{' '}
              by proceeding, you acknowledge the risk of breaking your own code
              or apps that use your code.
            </Text>
          </div>
        </div>
      </SideLayout>
    </div>
  );
}

export const Route = createFileRoute('/')({
  component: Main,
});
