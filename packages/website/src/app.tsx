import { clsx } from 'clsx';
import { type JSX, type ReactNode, useState } from 'react';
import { highlight } from 'sugar-high';
import { twMerge } from 'tailwind-merge';

declare const __VERSION__: string;

interface LinkProps {
  children: ReactNode;
  className?: string;
  href?: string;
  onClick?: () => void;
}

interface ListItemProps {
  children: ReactNode;
}

interface ListProps {
  children: ReactNode;
  className?: string;
}

interface SideLayoutProps {
  children: ReactNode;
}

interface TextProps {
  as?: keyof JSX.IntrinsicElements;
  children: ReactNode;
  className?: string;
}

export default function App() {
  const [imgSize, setImgSize] = useState(50);
  const [isSpinning, setIsSpinning] = useState(false);

  return (
    <div className="bg-[#101010]">
      <SideLayout>
        <div className="flex items-center gap-[1ch]">
          <div className="flex items-center gap-[0.5ch]">
            <img
              alt="bippy logo"
              className={cn('select-none', isSpinning && 'animate-spin')}
              height={imgSize}
              onClick={() => setImgSize(imgSize + 10)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setImgSize(imgSize + 10);
                }
              }}
              onMouseEnter={() => setIsSpinning(true)}
              onMouseLeave={() => setIsSpinning(false)}
              src="/bippy.png"
              width={imgSize}
            />
            <Text as="h1" className="font-bold text-2xl">
              bippy
            </Text>
          </div>
          <Link
            className="hidden sm:flex"
            href="https://github.com/aidenybai/bippy"
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
          <code
            className="whitespace-pre-wrap"
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
        </pre>

        <div className="flex my-[2ch]">
          <a href="https://github.com/aidenybai/bippy">
            <button
              className="bg-white text-black px-[1ch] py-[0.5ch] rounded-sm hover:bg-white/90 transition-all duration-150 font-bold text-lg"
              type="button"
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

export function cn(...inputs: (boolean | string | undefined)[]) {
  return twMerge(clsx(inputs));
}

function Link({ children, className, href, onClick, ...props }: LinkProps) {
  return (
    <a
      className={cn('underline hover:bg-black hover:text-white', className)}
      href={href}
      onClick={onClick}
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
