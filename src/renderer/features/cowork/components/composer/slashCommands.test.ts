import { describe, expect, test } from 'vitest';

import { getSlashCommandCompletions, mergeAppSlashCommands, SLASH_COMMANDS } from './slashCommands';

describe('composer slash commands', () => {
  test('keeps the app-owned Plan command when Gateway commands refresh', () => {
    const commands = mergeAppSlashCommands([
      {
        key: 'compact',
        name: 'compact',
        description: 'Compact the session.',
        category: 'session',
      },
    ]);

    expect(commands.map(command => command.name)).toEqual(['compact', 'plan']);
    expect(getSlashCommandCompletions('pla', { commands })).toMatchObject([
      { name: 'plan', executeLocal: true },
    ]);
  });

  test('keeps the app-owned Plan definition when a future Gateway advertises it', () => {
    const gatewayPlan = {
      key: 'plan',
      name: 'plan',
      description: 'Gateway Plan command.',
      category: 'session' as const,
    };

    expect(mergeAppSlashCommands([gatewayPlan])).toEqual([
      expect.objectContaining({ name: 'plan', executeLocal: true }),
    ]);
    expect(SLASH_COMMANDS).toContainEqual(expect.objectContaining({ name: 'plan' }));
  });

  test('removes a conflicting Plan alias from a Gateway command', () => {
    expect(
      mergeAppSlashCommands([
        {
          key: 'future',
          name: 'future',
          aliases: ['plan', 'later'],
          description: 'Future command.',
        },
      ]),
    ).toEqual([
      expect.objectContaining({ name: 'future', aliases: ['later'] }),
      expect.objectContaining({ name: 'plan', executeLocal: true }),
    ]);
  });

  test('keeps the internal side-chat protocol out of the user command menu', () => {
    const commands = mergeAppSlashCommands([
      {
        key: 'btw',
        name: 'btw',
        aliases: ['side'],
        description: 'Internal side question.',
      },
      {
        key: 'future',
        name: 'future',
        aliases: ['btw', 'later'],
        description: 'Future command.',
      },
    ]);

    expect(commands.map(command => command.name)).not.toContain('btw');
    expect(commands).toContainEqual(
      expect.objectContaining({ name: 'future', aliases: ['later'] }),
    );
    expect(SLASH_COMMANDS.map(command => command.name)).not.toContain('btw');
  });
});
