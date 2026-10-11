import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { createSerialQueue, SerialQueue } from '../../src/domain/serialQueue';

const feature = loadFeature(path.resolve(__dirname, '../__features__/serial-queue.feature'));

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

defineFeature(feature, (test) => {
  let queue: SerialQueue;
  let log: string[];

  const givenQueue = (given: any) =>
    given('a serial queue', () => {
      queue = createSerialQueue();
      log = [];
    });

  test('Overlapping jobs run one at a time, in the order they were queued', ({ given, when, then }) => {
    givenQueue(given);
    when(/^three slow jobs "(.*)", "(.*)" and "(.*)" are queued at once$/, async (...names: string[]) => {
      await Promise.all(
        names.map((name) =>
          queue.run(async () => {
            log.push(`start ${name}`);
            await tick();
            await tick();
            log.push(`end ${name}`);
          })
        )
      );
    });
    then(
      /^the jobs should have run in the order "(.*)", "(.*)", "(.*)" without overlapping$/,
      (...names: string[]) => {
        expect(log).toEqual(names.flatMap((n) => [`start ${n}`, `end ${n}`]));
      }
    );
  });

  test('A failed job rejects only its own caller and the next job still runs', ({
    given,
    when,
    then,
    and,
  }) => {
    givenQueue(given);
    let failure: unknown;
    when(/^a job that fails is queued, then a job "(.*)"$/, async (name: string) => {
      const failing = queue.run(async () => {
        await tick();
        throw new Error('disk full');
      });
      const after = queue.run(async () => {
        log.push(name);
      });
      failure = await failing.catch((e) => e);
      await after;
    });
    then("the failing job's caller should see the failure", () => {
      expect(failure).toBeInstanceOf(Error);
    });
    and(/^the job "(.*)" should have run$/, (name: string) => {
      expect(log).toEqual([name]);
    });
  });
});
