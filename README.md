# test-machinepack
Raw test runner for machinepacks (also includes a generic driver)

> Note that this built-in test driver is pretty basic-- I wouldn't recommend using it.  There is a better driver for mocha that you might enjoy: https://github.com/mikermcneil/test-machinepack-mocha
> The point of this module is mainly to expose a test runner.
>
> Confused?  See http://node-machine.org for documentation.


## Installation

```bash
npm install -g test-machinepack
```

## Usage

You can use the generic driver to run tests.  To do that, just `cd` into your machinepack and then run:

```bash
testmachinepack
```


## Custom drivers

Want to build a driver for the test framework of your choice?
See https://github.com/mikermcneil/test-machinepack-mocha for an example, and check out the files in this repo to see how the driver interface is exposed.


## License

MIT
