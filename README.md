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


## Writing tests

Tests will be written in JSON or [JSON5](http://json5.org/) format (with .json5 file ending). For each machine you have define you create a JSON file with the same name within a `tests` folder. If you install [machinepack](https://github.com/node-machine/machinepack) and run `pm scrub` skeleton files will be created for you.

The general format looks like this:

```js
//machine-name.json, or machine-name.json5 if you want comment support
{
  //name of the machine as per filename
  "machine": "machine-name",
  //within expectations you define the tests of your machine
  //based on the inputs and exits you have defined
  "expectations": [
    {
      //todo truthy means the test will be skipped
      "todo": true,
      "using": {
        "variable1": ""
      },
      "outcome": ""
    },
    {
      "using": {
        "variable1": "value"
      },
      "outcome": "error"
    },
    {
      "using": {
        "variable": "value1",
        "variable2": "value2"
      },
      "outcome": "error"
    }
  ]
}
```

So what do real tests look like?
Check out this example from [machinepack-npm](http://node-machine.org/machinepack-npm):
https://github.com/mikermcneil/machinepack-npm/blob/master/tests/list-packages.json


## Custom drivers

Want to build a driver for the test framework of your choice?
See https://github.com/mikermcneil/test-machinepack-mocha for an example, and check out the files in this repo to see how the driver interface is exposed.


## License

MIT

&copy; 2015-2017 Mike McNeil
