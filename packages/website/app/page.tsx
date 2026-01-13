import Image from 'next/image';
import { CodeBlock } from '@/components/code-block';
import { InlineCodeBlock } from '@/components/inline-code-block';
import { FiberTree } from '@/components/fiber-tree';
import { Collapsible } from '@/components/collapsible';
import { Mermaid } from '@/components/mermaid';
import { InspectorDemo } from '@/components/inspector-demo';

export default function Home() {
  return (
    <div className="flex flex-col gap-4 max-w-[600px] p-5 pt-7 lg:p-10 leading-relaxed text-base overflow-x-visible mx-auto">
      <h1 className="text-lg font-semibold flex items-center gap-2">
        <Image src="/logo.png" alt="bippy logo" width={32} height={32} />
        bippy
      </h1>

      <p>bippy is a library that allows you to hack into react internals</p>

      <div className="flex gap-2">
        <a
          href="#examples"
          className="inline-flex items-center gap-2 px-4 py-2 bg-white text-[#111] font-medium hover:bg-[#e0e0e0] transition-colors"
        >
          get started
        </a>
        <a
          href="https://github.com/aidenybai/bippy"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#333] text-white font-medium hover:bg-[#444] transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
          github
        </a>
      </div>

      <div className="bg-[#eda33b]/25 text-white p-[1ch]">
        <div>
          <p className="text-xs">
            <span className="text-xs font-bold">⚠️ warning: </span>
            <span className="text-xs">
              this project may break production apps and cause unexpected
              behavior
            </span>
          </p>
        </div>
        <div className="mt-[1ch]">
          <p className="text-xs">
            this project uses react internals, which can change at any time. it
            is not recommended to depend on internals unless you really,{' '}
            <span className="text-xs italic">really have to.</span> by
            proceeding, you acknowledge the risk of breaking your own code or
            apps that use your code.
          </p>
        </div>
      </div>

      <hr className="border-[#292929]" />

      <p>
        before hacking into react, it helps to understand how it works under the
        hood.
      </p>

      <Collapsible title="how does react work?">
        <p>
          react&apos;s core premise is that ui is a pure function of state:
        </p>

        <CodeBlock>{`ui = fn(state)`}</CodeBlock>

        <p>
          given the same state, you always get the same ui. a component is just
          a function that takes data and returns a description of what should
          appear on screen:
        </p>

        <CodeBlock>{`function Greeting(name) {
  return { tag: 'h1', props: { children: 'Hello, ' + name } }
}

Greeting('World')
// { tag: 'h1', props: { children: 'Hello, World' } }`}</CodeBlock>

        <p>
          complex uis are built by composing these functions together, forming a
          tree:
        </p>

        <CodeBlock>{`function App(user) {
  return {
    tag: 'div',
    props: {
      children: [
        Greeting(user.name),
        Profile(user)
      ]
    }
  }
}`}</CodeBlock>

        <p>
          but directly rebuilding the entire dom on every state change would be
          slow. instead, react uses a virtual dom: a lightweight javascript
          representation of the ui.
        </p>

        <p>
          say we have a page showing &quot;Hello World&quot; and the state
          changes to &quot;Hello React&quot;. rather than rebuilding the whole
          dom, react compares the two virtual trees and figures out only the
          span text changed:
        </p>

        <Mermaid
          chart={`flowchart LR
  subgraph prev["previous tree"]
    A[div] --> B[h1]
    A --> C[span]
    B --> D["Hello"]
    C --> E["World"]
  end
  subgraph new["new tree"]
    F[div] --> G[h1]
    F --> H[span]
    G --> I["Hello"]
    H --> J["React"]
  end
  prev --> |diff| new
  style J fill:#f5be93,color:#111`}
        />

        <p>
          react then applies just that one change to the real dom. this diffing
          process is called <strong>reconciliation</strong>.
        </p>
      </Collapsible>

      <Collapsible title="scheduling">
        <p>
          in earlier versions, react walked the tree recursively in one
          synchronous pass. large trees block the main thread and animations
          drop frames.
        </p>

        <p>
          but not all updates are equal. a user click should interrupt a
          background data fetch:
        </p>

        <Mermaid
          chart={`flowchart LR
  A[process fiber] --> B{higher priority waiting?}
  B --> |no| C[next fiber]
  B --> |yes| D[⚡ yield]
  D --> E[do urgent work]
  E --> F[resume later]
  C --> A
  style D fill:#f5be93,color:#111
  style E fill:#f5be93,color:#111`}
        />

        <p>
          react uses a &quot;pull&quot; approach: instead of applying updates
          immediately (push), it delays work until necessary. this lets the
          framework prioritize what matters.
        </p>

        <p>
          to enable this, react needs to break work into units that can be
          paused, resumed, or aborted. this is where <strong>fiber</strong>{' '}
          comes in.
        </p>
      </Collapsible>

      <Collapsible title="what is a fiber?">
        <p>
          rendering a react app is like calling nested functions. the cpu tracks
          this with the call stack, and when too much runs at once, the ui
          freezes.
        </p>

        <p>
          fiber reimplements the stack as a linked list. each fiber points to
          its <InlineCodeBlock>child</InlineCodeBlock>,{' '}
          <InlineCodeBlock>sibling</InlineCodeBlock>, and{' '}
          <InlineCodeBlock>return</InlineCodeBlock> (parent):
        </p>

        <Mermaid
          chart={`flowchart TB
  App --> |child| Header
  Header --> |sibling| Main
  Main --> |sibling| Footer
  Header --> |return| App
  Main --> |return| App
  Footer --> |return| App
  Main --> |child| Content
  Content --> |return| Main
  style App fill:#f5be93,color:#111`}
        />

        <p>
          this structure lets react pause mid-tree, resume later, or abort —
          impossible with a native call stack.
        </p>

        <p>
          in concrete terms, a fiber is a javascript object:
        </p>

        <CodeBlock>{`interface Fiber {
  type: any;
  key: string | null;

  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;

  alternate: Fiber | null;
  stateNode: Node | null;

  pendingProps: any;
  memoizedProps: any;
  memoizedState: any;

  dependencies: Dependencies | null;
  updateQueue: any;
}`}</CodeBlock>

        <p>
          <InlineCodeBlock>child</InlineCodeBlock>,{' '}
          <InlineCodeBlock>sibling</InlineCodeBlock>, and{' '}
          <InlineCodeBlock>return</InlineCodeBlock> form the tree structure as a
          singly-linked list.{' '}
          <InlineCodeBlock>alternate</InlineCodeBlock> links to the
          corresponding fiber in the other tree (current or work-in-progress).
          when <InlineCodeBlock>pendingProps</InlineCodeBlock> equals{' '}
          <InlineCodeBlock>memoizedProps</InlineCodeBlock>, react can skip
          re-rendering.
        </p>

        <p>
          react uses{' '}
          <a
            href="https://en.wikipedia.org/wiki/Multiple_buffering"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            double buffering
          </a>{' '}
          (a technique from game graphics): it
          maintains a current tree (what&apos;s on screen) and builds a
          work-in-progress tree in the background. when ready, react swaps them
          in one commit. try clicking the button below to see this in action:
        </p>

        <FiberTree />
      </Collapsible>

      <Collapsible title="accessing fibers">
        <p>
          fibers aren&apos;t directly exposed to users. however, since react 16,
          react reads from{' '}
          <InlineCodeBlock>
            window.__REACT_DEVTOOLS_GLOBAL_HOOK__
          </InlineCodeBlock>{' '}
          and calls handlers on commit. this is what{' '}
          <a
            href="https://react.dev/learn/react-developer-tools"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            react developer tools
          </a>{' '}
          uses. the hook must exist before react loads.
        </p>

        <CodeBlock>{`interface __REACT_DEVTOOLS_GLOBAL_HOOK__ {
  renderers: Map<RendererID, ReactRenderer>;

  onCommitFiberRoot: (
    rendererID: RendererID,
    root: FiberRoot,
    commitPriority?: number,
  ) => void;

  onPostCommitFiberRoot: (
    rendererID: RendererID,
    root: FiberRoot
  ) => void;

  onCommitFiberUnmount: (
    rendererID: RendererID,
    fiber: Fiber
  ) => void;
}`}</CodeBlock>

        <p>
          bippy installs a handler on this hook before react loads. on every
          commit, react calls the hook and your handler receives the fiber root:
        </p>

        <Mermaid
          chart={`flowchart LR
  A[page load] --> B[bippy installs hook]
  B --> C[react loads]
  C --> D[commit]
  D --> E["hook.onCommitFiberRoot(root)"]
  E --> F[your handler]
  F --> |next commit| D
  style B fill:#f5be93,color:#111
  style F fill:#f5be93,color:#111`}
        />
      </Collapsible>

      <Collapsible title="hack a react app with bippy" id="examples">
        <p>
          now let&apos;s put what we learned into practice. we&apos;ll build an
          inspector that shows you which react component you&apos;re hovering
          over — like react devtools, but simpler and yours.
        </p>

        <p>
          <strong>step 1: get the fiber from a dom element</strong>
        </p>

        <p>
          every dom element rendered by react has a fiber attached to it. use{' '}
          <InlineCodeBlock>getFiberFromHostInstance</InlineCodeBlock>:
        </p>

        <CodeBlock>{`import { getFiberFromHostInstance } from 'bippy';

const fiber = getFiberFromHostInstance(element);`}</CodeBlock>

        <p>
          <strong>step 2: find the component</strong>
        </p>

        <p>
          dom elements are &quot;host&quot; fibers. use{' '}
          <InlineCodeBlock>traverseFiber</InlineCodeBlock> to walk up and find
          the nearest component:
        </p>

        <CodeBlock>{`import {
  traverseFiber,
  isCompositeFiber,
  getDisplayName
} from 'bippy';

const componentFiber = traverseFiber(
  fiber,
  isCompositeFiber,
  true
);
const name = getDisplayName(componentFiber.type);`}</CodeBlock>

        <p>
          <strong>step 3: highlight it</strong>
        </p>

        <p>
          use <InlineCodeBlock>getNearestHostFiber</InlineCodeBlock> to get the
          dom node from a component fiber, then draw a box around it:
        </p>

        <CodeBlock>{`import { getNearestHostFiber } from 'bippy';

const hostFiber = getNearestHostFiber(componentFiber);
const rect = hostFiber.stateNode.getBoundingClientRect();`}</CodeBlock>

        <p>
          try it yourself on this page:
        </p>

        <InspectorDemo />

        <p>
          that&apos;s it! a working react inspector in ~50 lines of code. bippy
          handles the hard parts: finding fibers, walking the tree, extracting
          names, and staying compatible across react 16.8 through 19.
        </p>

        <p>
          <strong>why use bippy for this?</strong>
        </p>

        <p>
          without bippy, you&apos;d need to:
        </p>

        <ul className="list-disc pl-6 flex flex-col gap-1">
          <li>
            find the secret <InlineCodeBlock>__reactFiber$</InlineCodeBlock>{' '}
            property on dom nodes (the key changes between react versions)
          </li>
          <li>
            handle differences in fiber structure between react 16, 17, 18, and
            19
          </li>
          <li>
            write your own tree traversal and name extraction
          </li>
          <li>
            deal with edge cases like fragments, portals, and strict mode
          </li>
        </ul>

        <p>
          bippy is ~3kb and does all of this for you. go build something cool.
        </p>
      </Collapsible>

      <hr className="border-[#292929]" />

      <div className="flex flex-col items-center gap-4 py-8">
        <p className="text-center">
          if bippy helped you, consider giving it a star on github
        </p>
        <a
          href="https://github.com/aidenybai/bippy"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 bg-white text-[#111] font-medium hover:bg-[#e0e0e0] transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
          star on github
        </a>
        <p className="text-sm text-[#888] text-center">
          watch{' '}
          <a
            href="https://www.youtube.com/watch?v=aV1271hd9ew"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            this great talk
          </a>{' '}
          to learn more about react fiber internals, or{' '}
          <a
            href="https://repogrep.com/facebook/react"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            explore the react codebase
          </a>
        </p>
        <a
          href="https://aidenybai.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            src="/sig.webp"
            alt="signature"
            width={100}
            height={40}
            className="mt-4 opacity-50 invert"
          />
        </a>
      </div>
    </div>
  );
}
