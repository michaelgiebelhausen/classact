import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library registers this itself only when vitest runs with
// `globals: true`, which this project doesn't. Without it, every render in a
// file stacks up in the same document and the second test to look for the
// same text fails with "found multiple elements" — a confusing failure that
// has nothing to do with the component under test.
afterEach(cleanup);
