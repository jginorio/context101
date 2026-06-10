/**
 * Entry point. Runs the generator to completion and exits with its status,
 * mirroring `if __name__ == "__main__": sys.exit(main())` in generate.py.
 */

import { main } from "./generate.js";

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
