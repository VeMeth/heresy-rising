# Heresy Rising 5-Minute Dungeon Compliance Gap Fill

Version: 1.0
Date: 2026-06-27
Purpose: implementation notes to bring the online Heresy Rising rules closer to the fact-checked 5-Minute Dungeon guide.

## 1. Ruleset model

Do not model everything as one boolean `expandedContent`. Use a small ruleset enum, because Kickstarter Booster and Curses! Foiled Again! are different content layers.

Recommended values:

```ts
type Ruleset = 'base' | 'kickstarter_booster' | 'curses' | 'big_box';
```

Behavior:

| Ruleset | Bosses | Heroes | Door pool | Challenge pool | Boss Cards | Artifacts | Curses |
|---|---:|---|---|---|---|---|---|
| base | 1-5 | original 10 | 40 base doors | 10 base challenge cards | no | no | no |
| kickstarter_booster | 1-7 | original 10 | 40 base + 15 booster doors | base + booster challenge cards | no, unless combined | no | no |
| curses | 1-5, or 1-6 if your content includes K.I.C.K. | original 10 + Druid/Shaman | base doors unless combined with booster | base + 2 Curses challenge cards | yes | yes | yes |
| big_box | 1-7 | original 10 + Druid/Shaman | base + booster doors | base + booster + Curses challenge cards | yes | yes | yes |

If you want one simple lobby toggle, label it `Big Box / All Expansions`, not just `Expanded`, because it currently mixes Kickstarter bosses, booster challenge cards, and Curses heroes/mechanics.

## 2. Dungeon-building algorithm

### Base / no Boss Cards

```ts
const dungeon = [
  ...drawRandom(doorPool, boss.doorCount),
  ...drawRandom(challengePool, players.length * 2)
];
shuffle(dungeon);
```

### Curses / Boss Cards enabled

For bosses with a Boss Deck:

```ts
const bossCards = getBossDeck(boss.id); // 5 cards for normal Curses bosses
const requiredDoorCount = boss.doorCount - bossCards.length;
const dungeon = [
  ...bossCards,
  ...drawRandom(doorPool, requiredDoorCount),
  ...drawRandom(challengePool, players.length * 2)
];
shuffle(dungeon);
```

For Dungeon Master Final Form with Boss Cards:

```ts
const bossCards = chooseOneRandomFromEachBossDeck([1,2,3,4,5,6]); // 6 cards
const requiredDoorCount = 50 - bossCards.length; // 44 Door Cards
const dungeon = [
  ...bossCards,
  ...drawRandom(doorPool, requiredDoorCount),
  ...drawRandom(challengePool, players.length * 2)
];
shuffle(dungeon);
```

Important: do not top up Boss #7 with Challenge Cards just because only 40 Door Cards are encoded. If the selected ruleset needs 44+ Door Cards, encode the 15 Kickstarter Booster Door Cards and draw from the expanded 55-card Door pool.

## 3. Boss table

```ts
const BOSSES = [
  { id: 1, name: 'Baby Barbarian', doorCount: 20, resources: { sword: 2, arrow: 2, jump: 3 } },
  { id: 2, name: 'The Grime Reaper', doorCount: 25, resources: { scroll: 7, shield: 3 } },
  { id: 3, name: 'Zola the Gorgon', doorCount: 30, resources: { sword: 4, shield: 3, jump: 3 } },
  { id: 4, name: "A Freakin' Dragon!!!", doorCount: 35, resources: { sword: 1, jump: 4, arrow: 4, shield: 1 } },
  { id: 5, name: 'The Dungeon Master', doorCount: 40, resources: { sword: 3, arrow: 3, shield: 3, scroll: 3 } },
  { id: 6, name: 'The K.I.C.K. 9000', doorCount: 20, fixedChallengeCount: 10, resources: { shield: 2, sword: 4, arrow: 4, jump: 1 } },
  { id: 7, name: 'The Dungeon Master (Final Form)', doorCount: 50, resources: { sword: 2, arrow: 2, shield: 2, jump: 4, scroll: 5 } }
];
```

Boss #6 note: if `fixedChallengeCount: 10` is active, use 10 Challenge Cards for that boss setup instead of `players.length * 2`, unless your current guide/ruleset deliberately says otherwise.

## 4. Kickstarter Booster Challenge Cards

### Mini-Bosses

```ts
const BOOSTER_MINIBOSSES = [
  { id: 'low_tech_mech', name: 'A Low-Tech Mech', resources: { sword: 2, arrow: 3 } },
  { id: 'very_mini_miniboss', name: 'A Very Mini Mini-Boss', resources: { jump: 1, shield: 1, scroll: 1 } },
  { id: 'das_boot', name: 'Das Boot!', resources: { sword: 2, jump: 3 } },
  { id: 'dreaded_tri_bread', name: 'The Dreaded Tri-Bread', resources: { jump: 2, scroll: 1, arrow: 2 } },
  { id: 'goblin_king', name: 'The Goblin King', resources: { scroll: 2, shield: 2, sword: 1 } }
];
```

### Events

```ts
const BOOSTER_EVENTS = [
  {
    id: 'dungeon_error_in_your_favor',
    name: 'Dungeon Error in Your Favor',
    effect: { type: 'allPlayersDraw', count: 5 }
  },
  {
    id: 'gimme_a_hand',
    name: 'Gimme a Hand!',
    effect: { type: 'allPlayersPassHandToChosenPlayer', requiresChoice: 'targetPlayer' }
  },
  {
    id: 'locked_door',
    name: 'Locked Door!',
    effect: { type: 'chooseResourceThenAllDiscardMatchingResourceCards', requiresChoice: 'resourceType' }
  },
  {
    id: 'ungodly_porcupines',
    name: 'An Ungodly Amount of Porcupines',
    effect: { type: 'allPlayersDrawThenDiscard', draw: 3, discard: 3, discardChoice: 'player' }
  },
  {
    id: 'yet_more_spikes',
    name: 'Yet More Spikes!',
    effect: { type: 'chosenPlayerDiscardsHand', requiresChoice: 'targetPlayer' }
  }
];
```

## 5. Choice UI required for full compliance

Do not implement choice events deterministically if you want compliance. Add a resolver state:

```ts
type PendingChoice =
  | { kind: 'choosePlayer'; sourceCardId: string; options: PlayerId[] }
  | { kind: 'chooseResource'; sourceCardId: string; options: ResourceType[] }
  | { kind: 'chooseCardType'; sourceCardId: string; options: ['action','resource'] }
  | { kind: 'chooseArtifact'; sourceCardId: string; options: ArtifactId[] };
```

Cards needing choice states:

- Gimme a Hand! -> choose one target player who receives all hands.
- Locked Door! -> choose one resource type; all players discard cards with that resource.
- Yet More Spikes! -> choose one player to discard their hand.
- Feeding the Trolls -> choose Action Cards or Resource Cards; all players discard chosen type.
- Crowd Funding -> choose one used Artifact to reactivate if any are used; then discard hands per card/rule text.

## 6. Curses mechanics to implement

Curses are persistent dungeon modifiers. They are not one-shot Events. When revealed, put them into `activeCurses`, then flip the next Dungeon Card. Multiple Curses can be active at once.

Suggested state:

```ts
type ActiveCurse = {
  id: string;
  name: string;
  rule: CurseRule;
  removableByCleanse: boolean;
};
```

Minimum curse rules to support from the official Curses rules:

- `noPause`: blocks Wizard Stop Time, Divine Shield, Time Warp, and Sundial Watch.
- `refillCap3`: players refill only to 3 cards; if another effect makes them draw above 3, they discard down to 3 afterward.
- `handFaceDown`: player hand hidden; allow one-card peek at a time if you want close digital simulation.
- `noBlackBorderCards`: blocks Action Cards, including Cleanse; Sheepified cannot be removed by Cleanse.
- `noHeroAbilities`: blocks hero abilities; Shaman cannot use its ability to move that Curse.
- `cardsFaceAwayFromOwner`: House Rules; practical digital implementation can hide a player's own hand from them but show it to teammates, or mark it as manual/unsupported.

For illegal curse-breaking, a strict implementation should undo the illegal action if possible and put the violator's hand into the center/sweep pile. A friendlier online implementation can prevent illegal clicks instead; document this as a UI guard rather than exact physical penalty behavior.

## 7. Curses / Boss-deck Events from official rules

Implement these before trying to make all 30 Boss Cards exact:

```ts
const CURSES_EVENTS = [
  {
    id: 'crowd_funding',
    type: 'event',
    effect: { type: 'reactivateUsedArtifactThenAllDiscardHand', requiresChoice: 'usedArtifactOptional' }
  },
  {
    id: 'feeding_the_trolls',
    type: 'event',
    effect: { type: 'teamChoosesActionOrResourceThenAllDiscardType', requiresChoice: 'cardType' }
  },
  {
    id: 'poisoned_milk',
    type: 'event',
    effect: { type: 'highestHandCountPlayersDiscardHand', tie: 'allTied' }
  },
  {
    id: 'acid_polish',
    type: 'event',
    effect: { type: 'playersHoldingShieldResourceDiscardAffectedCardsOrHand', needsPhysicalTextCheck: true }
  },
  {
    id: 'ensnared',
    type: 'event',
    effect: { type: 'allPlayersDiscardResourceCardsWithSymbol', symbol: 'jump' }
  },
  {
    id: 'corrosive_spit',
    type: 'event',
    effect: { type: 'allPlayersDiscardResourceCardsWithSymbol', symbol: 'shield' }
  },
  {
    id: 'my_swords',
    type: 'event',
    effect: { type: 'allPlayersDiscardResourceCardsWithSymbol', symbol: 'sword' }
  }
];
```

Note: Magic Bombs, Wild Cards, and other black-border Action Cards are not Resource Cards for symbol-discard Events.

## 8. Druid/Shaman deck minimum implementation

The official Curses rules confirm:

- 42 Druid/Shaman cards.
- Druid/Shaman do not specialize in one resource.
- 10 Infinity Cards: 2 for each resource type.
- Infinity Cards match all symbols of their type on a Door Card or Boss.
- Cleanse removes one active Curse, except it cannot remove Sheepified because Sheepified blocks black-border cards.
- Ancient Healing: all players draw the top 2 cards from their discard pile; no searching.

Minimum implementation:

```ts
const DRUID_SHAMAN_SPECIALS = [
  { id: 'cleanse', type: 'action', effect: 'removeActiveCurse', cannotRemove: ['sheepified'] },
  { id: 'ancient_healing', type: 'action', effect: { type: 'allPlayersDrawFromDiscardTop', count: 2 } },
  { id: 'infinity_sword', type: 'infinityResource', symbol: 'sword', countInDeck: 2 },
  { id: 'infinity_arrow', type: 'infinityResource', symbol: 'arrow', countInDeck: 2 },
  { id: 'infinity_scroll', type: 'infinityResource', symbol: 'scroll', countInDeck: 2 },
  { id: 'infinity_jump', type: 'infinityResource', symbol: 'jump', countInDeck: 2 },
  { id: 'infinity_shield', type: 'infinityResource', symbol: 'shield', countInDeck: 2 }
];
```

Remaining Druid/Shaman card counts and exact other card names still need physical-card/wiki pass before claiming full 42-card fidelity.

## 9. Artifacts

Official Curses behavior:

- There are 6 Artifact Cards, one per player deck.
- After players choose decks, the team receives the artifacts for decks not chosen.
- Artifacts are shared by the team and can be used any time.
- Each artifact is once per dungeon; flip used artifacts face-down.
- At the next dungeon, refresh all artifacts face-up.
- In a 2-player game with four decks chosen, the team gets the two artifacts for the two unused decks.

Suggested state:

```ts
type Artifact = {
  id: string;
  sourceDeck: DeckColor | 'druid_shaman';
  used: boolean;
  effect: ArtifactEffect;
};
```

If exact artifact effects are not encoded, keep artifacts disabled rather than pretending Curses is fully implemented.

## 10. Priority list for Aemos

1. Split `expandedContent` into `ruleset` or at least separate `kickstarterBoosterEnabled` and `cursesEnabled`.
2. Encode 15 Kickstarter Door Cards so Boss #7 can draw 44 Door Cards when Boss Cards are active.
3. Stop using Challenge Cards as filler for Boss #7 Door requirements.
4. Add proper pending-choice UI/resolver for choice Events.
5. Implement persistent `activeCurses` state.
6. Add Druid/Shaman minimum deck behavior: Infinity cards, Cleanse, Ancient Healing.
7. Add artifact state only if exact artifact effects are known; otherwise leave artifacts disabled and mark Curses as partial.
8. Add test cases for: Final Form dungeon composition, choice events, Cursed Blocks refill cap, Sheepified blocking Cleanse, no-pause curses blocking Stop Time/Divine Shield, and Locked Door resource discard excluding black-border Action Cards.
