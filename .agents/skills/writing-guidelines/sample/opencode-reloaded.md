## OpenCode Reloaded Sample

Let’s discuss the subtle pleasures of hot reloading. It spares us from the tedium of minor exertions, of hitting `⌘R` when we could have otherwise remained blissfully inert. To the human mind, the gulf between even the most negligible of impediments and none whatsoever is infinite.

Thus, in OpenCode 2, we’ve gone through the trouble of making all reloading as unbearably hot as possible.

OpenCode can edit its config, connect an MCP server, or write a plugin, and any changes will immediately take effect across every session. It can make a tool for itself and invoke it the very same turn—without needing to quit, type `/reload`, or start a new session, and certainly without busting the cache.

## The Problem

OpenCode’s environment (its models, tools, agents, skills, etc.) is assembled by plugins. Much of its default behavior lives in built-in plugins. And you, dear reader, can install additional plugins, write your own, or ask OpenCode to write one for you.

For instance, a built-in plugin populates the model catalog with data from models.dev. While OpenCode is running, it periodically refreshes that data to keep up with the ever-increasing rate of model releases.

How do several plugins coordinate modifying the same catalog? Let’s start with a naive implementation and refine it together as it fails us in one way or another.

For our first attempt, we’ll give plugins direct access to a shared model catalog through the `ctx` argument every plugin receives. They can reach in and rearrange it as they see fit: adding models, replacing them, or changing their settings.

It fetches all the latest provider data from models.dev 1 and writes it into the model catalog 2. This happens at startup and once an hour thereafter 3.

Alas, there’s already a bug. If models.dev removes a provider, it’ll remain in our catalog forever because we don’t clean up missing entries. But before we fix this, let’s make things worse.

Here’s another plugin that modifies the catalog. This one disables models from certain providers, perhaps to align with some boring corporate policy.

On startup, these run in order. First, the models.dev plugin fills the catalog; then our policy plugin disables the restricted models. So far, so good.

However, when the refresh timer fires, the models.dev plugin completely replaces those provider records with fresh values, inadvertently undoing everything our policy plugin did.

To deal with this, let’s have the models.dev plugin announce each refresh, and have our policy plugin listen for that announcement and disable the models again after each one.

```ts
export async function providerPolicy(ctx) {
  await ctx.event.on("catalog.updated", () => {
    disableProviders(ctx.catalog)
  })

  disableProviders(ctx.catalog)
}

function disableProviders(catalog) {
  const excludedProviders = new Set(["perinium", "sphinctral"])

  for (const provider of Object.values(catalog)) {
    if (!excludedProviders.has(provider.id)) continue

    for (const model of Object.values(provider.models)) {
      model.disabled = true
    }
  }
}
```

This is getting complicated. We now have a background process changing the catalog and another plugin responding to those changes. We also have to make sure nobody reads the fresh catalog before our policy has run.

Even if we sort all that out, we only got away with re-running our policy because disabling an already-disabled model does nothing. It’s idempotent. Consider instead a plugin which halves each model’s output limit, the maximum number of tokens a model may produce in one reply.

```ts
export async function limits(ctx) {
  await ctx.event.on("catalog.updated", () => {
    halveLimits(ctx.catalog)
  })

  halveLimits(ctx.catalog)
}

function halveLimits(catalog) {
  for (const provider of Object.values(catalog)) {
    for (const model of Object.values(provider.models)) {
      model.limit.output /= 2
    }
  }
}
```

Suppose another plugin, `local-model.ts`, adds a couple of models that run on your own machine. Following our policy plugin’s lead, we re-run `halveLimits` after each catalog update to catch the additions, but it also halves the models we’ve already handled. Their limits are now a quarter of what they started with.

| Model | Output |
| --- | --- |
| **OpenAI** | |
| GPT-6 Astra | 128K |
| GPT-5.6 Sol | 128K |
| **Local** | |
| Couch Potato 8B | 128K |
| Pocket Goblin 14B | 128K |

`catalog.updated`

If we continue down this path, every plugin has to keep track of what every other plugin has done. It would become an inextricable clusterfuck.

These bugs have the same cause. Plugins are mutating a shared catalog in place, so the result depends on how many times each one has run and in what order. Let’s see how we addressed that in OpenCode.

## The Solution

Instead of wrestling with this tangled mass of imperativity, wouldn’t it be lovely if a plugin could describe its change, and let OpenCode decide when to apply it?

That’s what we did. Each plugin hands OpenCode a catalog transformation function; OpenCode keeps them in order and threads an empty catalog through each one in turn.

The catalog starts empty. 1 `models-dev.ts` fills in OpenAI and Sphinctral, 2 `local-model.ts` adds our two local models, 3 `provider-policy.ts` disables Sphinctral, and 4 `limits.ts` halves every output limit, 128K to 64K. And out pops the final catalog.

Each plugin is now only responsible for its own changes, while OpenCode takes care of when and in what order to run them. Here is the reworked `provider-policy.ts`. Notice that `ctx.catalog` is no longer the catalog itself but a handle to it, and the plugin registers its model-disabling operation as a transformation:

**`provider-policy.ts`**

```ts
export async function providerPolicy(ctx) {
  const excludedProviders = new Set(["perinium", "sphinctral"])

  await ctx.catalog.transform(catalog => {
    for (const provider of Object.values(catalog)) {
      if (!excludedProviders.has(provider.id)) continue

      for (const model of Object.values(provider.models)) {
        model.disabled = true
      }
    }
  })
}
```

### Reloading

Before, plugins had free rein to mutate the catalog whenever and however they pleased. Now they register transformations up front. But with this architecture, how would the models.dev plugin update the catalog on its hourly cadence?

It calls `ctx.catalog.reload()`, which creates a new empty catalog, pipes it through the various transformations, and then publishes the result. Behold

**`models-dev.ts`**

```ts
export async function modelsDev(ctx) {
  let providers = await fetchModelsDev() // 1

  await ctx.catalog.transform(catalog => { // 2
    for (const provider of Object.values(providers)) {
      catalog[provider.id] = structuredClone(provider)
    }
  })

  setInterval(async () => {
    providers = await fetchModelsDev() // 3
    await ctx.catalog.reload() // 4
  }, 60 * 60 * 1000)
}
```

The plugin fetches the provider data 1 and registers a transformation that closes over it 2. Every hour it fetches again, replacing the variable 3, and calls `ctx.catalog.reload()` 4. The transformation itself never changes, but it reads `providers` when it runs, so the next rebuild picks up whatever was fetched last.

Because every rebuild starts from an empty catalog and runs every transformation exactly once, in order, the refresh can no longer undo the policy, a provider that disappears from models.dev disappears from the catalog with it, and halving a limit halves it once.

### State

The catalog is not special. It is one instance of a small `State` abstraction that every registry in OpenCode is built on: skills, commands, agents, tools, MCP servers, formatters.

**`state.ts`**

```ts
const skills = State.create({
  initial: () => new Map(),
  notify: () => bus.publish(Skill.Updated),
})

await skills.transform(skills => skills.set(mySkill.id, mySkill)) // replays on rebuild
await skills.reload() // rebuild now, notify every listener
```

A `State` has two methods: `transform`, which registers a transformation, and `reload`, which rebuilds the value from scratch.

### Adding, editing and removing plugins

Beyond reloading within plugins, such as our catalog refresh example, we must also respond immediately to plugin files themselves being created, edited, or deleted. This is but a thin layer atop the `State` abstraction.

When a new plugin is written to the filesystem, OpenCode runs it and keeps track of each registered transformation, associating it with that plugin. The file watching is done by another built-in plugin.

Later, if that file is deleted, everything it registered is dropped, and the affected `State` is rebuilt without it. Editing a plugin is deletion followed by a fresh run: the old version’s transformations are dropped, the new version runs and registers its own, and the rebuild picks those up instead. Either way, every session sees the result.

## The End

So, that’s it. The core idea is to register and play back transformation functions. It’s simple and reliable because, given the same starting state and the same data, running the same sequence of transformations always produces the same result. Config, MCP servers, and plugins all reload the same way, because they’re all States.

That’s how it all works, with a few details elided. OpenCode is, of course, fully open source, if you want the rest.

## Postscript

If you’ve made it this far, I’d like to get something off my chest. I have, for the most part, resisted functional programming terms in the course of this post. But it struck me, when we first considered this design, that endomorphisms are inherently monoidal.

In fact, I shouted this at anyone who would listen. Endomorphisms are inherently monoidal, I would shriek, at the grocery store, to the cashier, to the dog tied up outside, to Dax in too many, too long huddles. And it’s so true, isn’t it? That endomorphisms are inherently monoidal?

I want to be clear that I did not go looking for this. I was looking for a way to disable a provider’s models without the next refresh undoing it. That is all I was looking for.

The first person I told was Dax. He said “sure.” He did not look up. I have since come to understand that “sure” is what people say when they have not yet understood that endomorphisms are inherently monoidal.

Consider the function that does nothing. It takes a catalog and returns it unchanged. I used to think of it as nothing. I now think of it as the identity, and I think of it often.

Two transformations, composed, are a transformation. This is not a design decision. It was true before OpenCode, before computers, before the grocery store. We merely noticed.

The cashier’s name is Denise. I know this now. She has stopped asking whether I found everything I was looking for, because I did, and I told her.

There is a dog tied up outside the grocery store most mornings. I don’t know whose. I have explained the associative law to it on three occasions, and on the third it lay down, which I took as agreement.

I tried, for a week, not to say it. I rephrased. “Functions from a type to itself compose nicely,” I said, at dinner, and my wife said “you’re doing it again,” and I was.

Thanks for reading.

One more thing. If you concatenate two lists, you get a list. If you add two numbers, you get a number. If you run two catalog transformations, one after the other, you get a catalog transformation. I trust you see where this is going, because it is going where it has always been going.

Dax has started scheduling our huddles for twenty-five minutes instead of thirty. He has not said why. He does not need to.

I dreamed I was a catalog. Plugins passed through me in order. I woke feeling that I had been rebuilt from empty, which is to say, feeling fine.

A colleague asked whether this was, technically, a monoid or merely a semigroup, given that nobody actually registers the identity transformation. I asked him whether zero exists if nobody adds it.

My dentist, mid-filling, asked me to raise my hand if anything hurt. I raised my hand. He stopped. I said, around the instruments, that endomorphisms are inherently monoidal. He said he would take that as a no.

The order matters. I want to be careful here, because people hear “monoid” and assume you can rearrange things freely. You cannot. The policy runs after the fetch. That is the whole point. Associativity is not commutativity, and I have lost friends over the difference.
