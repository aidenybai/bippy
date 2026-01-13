import Image from 'next/image';
import { CodeBlock } from '@/components/code-block';
import { InlineCodeBlock } from '@/components/inline-code-block';
import { FiberTree } from '@/components/fiber-tree';
import { Collapsible } from '@/components/collapsible';
import { Mermaid } from '@/components/mermaid';

export default function Home() {
  return (
    <div className="flex flex-col gap-4 max-w-[600px] p-5 pt-7 lg:p-10 leading-relaxed text-base overflow-x-visible mx-auto">
      <h1 className="text-lg font-semibold flex items-center gap-2">
        <Image src="/logo.png" alt="bippy logo" width={32} height={32} />
        bippy
      </h1>

      <p>bippy is a library that allows you to hack into react internals</p>

      <Collapsible title="examples" defaultOpen={false}>
        <p>
          <strong>listening to commits</strong> — use{' '}
          <InlineCodeBlock>instrument</InlineCodeBlock> to hook into react and{' '}
          <InlineCodeBlock>traverseRenderedFibers</InlineCodeBlock> to walk the
          tree:
        </p>

        <CodeBlock>{`import { instrument, traverseRenderedFibers } from 'bippy';

instrument({
  onCommitFiberRoot(rendererID, root) {
    traverseRenderedFibers(root, (fiber, phase) => {
      console.log(fiber, phase); // 'mount' | 'update' | 'unmount'
    });
  },
});`}</CodeBlock>

        <p>
          <strong>fiber from dom</strong> — get the fiber backing any dom
          element:
        </p>

        <CodeBlock>{`import { getFiberFromHostInstance } from 'bippy';

const button = document.querySelector('button');
const fiber = getFiberFromHostInstance(button);

console.log(fiber.memoizedProps); // { onClick: f, children: '...' }`}</CodeBlock>

        <p>
          <strong>source location</strong> — find where a component is defined
          (dev only):
        </p>

        <CodeBlock>{`import { getSource } from 'bippy/source';

const source = await getSource(fiber);
console.log(source);
// { fileName: '/src/App.tsx', lineNumber: 42, columnNumber: 5 }`}</CodeBlock>
      </Collapsible>

      <a
        href="https://github.com/aidenybai/bippy"
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        view on github
      </a>

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

      <Collapsible title="reconciliation vs rendering">
        <p>
          the dom is just one rendering target. react can also render to native
          ios and android views via react native, canvas, terminal UIs, and
          more. this is why &quot;virtual dom&quot; is a bit of a misnomer.
        </p>

        <p>
          react separates <strong>reconciliation</strong> (computing what
          changed) from <strong>rendering</strong> (applying those changes to a
          target):
        </p>

        <Mermaid
          chart={`flowchart LR
  R[reconciler] --> |diff| DOM[react-dom]
  R --> |diff| Native[react-native]
  R --> |diff| Other[...]
  style R fill:#f5be93,color:#111`}
        />

        <p>
          this lets react-dom and react-native share the same reconciler while
          using their own renderers.
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

      <Collapsible title="why bippy?">
        <p>
          react internals are unstable. field names change, data structures get
          reorganized, and behaviors shift between versions without warning.
          code that works on react 17 might break on react 18, and react 19
          changed even more.
        </p>

        <p>
          bippy handles this so you don&apos;t have to:
        </p>

        <ul className="list-disc pl-6 flex flex-col gap-1">
          <li>
            compatibility shims for react 16.8 through 19
          </li>
          <li>
            stable api that abstracts away internal changes
          </li>
          <li>
            lightweight (~3kb minified + gzipped, zero dependencies)
          </li>
          <li>
            handles edge cases: multiple react instances, strict mode double
            renders, concurrent features
          </li>
          <li>
            barebones primitives for building powerful tools, with guardrails to
            help you not mess up
          </li>
        </ul>

        <p>
          without bippy, you&apos;d need to maintain version-specific code paths
          and constantly update when react changes. bippy consolidates this into
          one tested, maintained library.
        </p>
      </Collapsible>

      <div className="bg-[#eda33b]/25 text-white p-[1ch]">
        <div>
          <p className="text-xs">
            <span className="text-xs font-semibold">⚠️ warning: </span>
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
    </div>
  );
}
