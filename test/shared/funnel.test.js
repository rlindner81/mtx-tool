"use strict";

const { Funnel, FunnelQueue, limiter } = require("../../src/shared/funnel");

// a simple helper to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("funnel", () => {
  describe("Funnel", () => {
    test("should execute a simple callback and return its result", async () => {
      const funnel = new Funnel(2);
      const result = await funnel.run(() => 42);
      expect(result).toBe(42);
    });

    test("should enforce capacity limit and run callbacks sequentially when capacity is exceeded", async () => {
      // set a capacity limit of 2
      const funnel = new Funnel(2);
      let currentConcurrent = 0;
      let maxConcurrent = 0;

      // an async task that increases the current count,
      // delays for a bit, then decreases the count
      const task = async () => {
        currentConcurrent++;
        if (currentConcurrent > maxConcurrent) {
          maxConcurrent = currentConcurrent;
        }
        // simulate async work
        await delay(50);
        currentConcurrent--;
        return 1;
      };

      // start three tasks. Because capacity is 2, at most 2 tasks should run concurrently.
      const p1 = funnel.run(task);
      const p2 = funnel.run(task);
      const p3 = funnel.run(task);

      // wait for all tasks to complete
      await Promise.all([p1, p2, p3]);
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    test("should propagate errors while still restoring capacity", async () => {
      const funnel = new Funnel(1);

      // first enqueue a callback that throws an error.
      const errorCallback = () => {
        throw new Error("Test error");
      };

      // capture the rejection and check error message
      await expect(funnel.run(errorCallback)).rejects.toThrow("Test error");

      // after a rejection, capacity should be restored so we can run another task.
      const successCallback = () => 99;
      const result = await funnel.run(successCallback);
      expect(result).toBe(99);
    });
  });

  describe("FunnelQueue", () => {
    test("should return results in calling order when dequeueAll is called", async () => {
      const funnelQueue = new FunnelQueue(2);

      // enqueue three tasks that resolve to different values with slight delays
      funnelQueue.enqueue(async () => {
        await delay(20);
        return "first";
      });
      funnelQueue.enqueue(async () => {
        await delay(10);
        return "second";
      });
      funnelQueue.enqueue(() => "third"); // synchronous function

      const results = await funnelQueue.dequeueAll();
      expect(results).toEqual(["first", "second", "third"]);
    });

    test("should throw an error from dequeueAll if any task rejects", async () => {
      const funnelQueue = new FunnelQueue(2);

      funnelQueue.enqueue(() => "ok");
      funnelQueue.enqueue(() => {
        throw new Error("failure");
      });
      funnelQueue.enqueue(() => "not reached");

      await expect(funnelQueue.dequeueAll()).rejects.toThrow("failure");
    });
  });

  describe("limiter", () => {
    test("should process all payloads with a given concurrency limit", async () => {
      const payloads = [1, 2, 3, 4, 5];
      // simple iterator that doubles the payload after a short delay
      const iterator = async (payload) => {
        await delay(10);
        return payload * 2;
      };

      const results = await limiter(2, payloads, iterator);
      expect(results).toEqual([2, 4, 6, 8, 10]);
    });

    test("should reject if the iterator throws an error", async () => {
      const payloads = [1, 2, 3];
      const iterator = async (payload) => {
        await delay(10);
        if (payload === 2) {
          throw new Error("iterator failure");
        }
        return payload;
      };

      await expect(limiter(2, payloads, iterator)).rejects.toThrow("iterator failure");
    });

    test("should process non-failing tasks and only propagate errors after dequeueAll", async () => {
      const payloads = [0, 1, 2, 3, 4, 5];
      const finished = {}; // will track each task's completion

      // The iterator: if payload is 1 or 2, throw an error; otherwise, complete normally.
      const iterator = async (payload) => {
        // simulate asynchronous work
        await delay(10);
        // Mark that this payload has been processed.
        finished[payload] = true;
        if (payload === 1 || payload === 3) {
          throw new Error(`Failure in task ${payload}`);
        }
        return payload * 2;
      };

      let caughtError;
      try {
        await limiter(3, payloads, iterator);
      } catch (err) {
        caughtError = err;
      }

      // Expect an error to have been thrown.
      expect(caughtError).toBeDefined();
      // Because tasks are enqueued in order and using Promise.allSettled in dequeueAll,
      // the first rejected entry comes from payload 1.
      expect(caughtError.message).toBe("Failure in task 1");

      // Ensure that even though errors occur, all tasks (including non-failing ones) eventually finish.
      for (let i = 0; i < payloads.length; i++) {
        expect(finished[i]).toBe(true);
      }
    });
  });
});
