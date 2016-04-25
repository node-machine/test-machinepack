module.exports = require('machine').build({

  identity: 'test-machine',

  inputs: {

    machineInstance: {
      example: '===',
      description: 'The already-instantiated machine instance.',
      required: true
    },

    using: {
      description: 'A dictionary of configured input values.',
      example: '===',
      protect: true,
      required: true
    },

    expectedOutcome: {
      description: 'The name of the exit callback that this machine should trigger.',
      example: 'success'
    },

    expectedOutput: {
      description: 'The return value this machine should provide.',
      example: '==='
    },

    maxDuration: {
      description: 'The max # of miliseconds to allow this machine to run before considering the test a failure.',
      example: 2000
    },

    postConditions: {
      description: 'A set of postcondition functions to run.',
      example: [{
        label: 'should result in a dictionary of some kind',
        fn:'->'
      }],
      defaultsTo: []
    }

  },


  exits: {

    invalidExpectedOutput: {
      description: 'Could not dehydrate and/or `JSON.parse` the specified expected output.'
    },

    cantStringifyOutput: {
      description: 'The return value could not be stringified into JSON - perhaps it contains circular references?',
      extendedDescription:
      'Note that we use the `===` exemplar here.  This is necessary because it is the simplest '+
      'way to represent `output: undefined`.  Even if we set the `output` facet to `===`, since '+
      'the base value for the ref type is `null` as of rttc@9.3.0, that wouldn\'t work either.',
      example: '===',
      // {
      //   message: 'Output returned by the `finglebär` machine\'s "foobar" exit could not be stringified...etc',
      //   outcome: 'success',
      //   output: '===?', (but could also be undefined)
      //   inspectedOutput: '{ stuff: "things" }',
      //   duration: 2948
      // }
    },

    failed: {
      description: 'The test failed because the result was not the expected output and/or the expected outcome.',
      outputFriendlyName: 'Failure report',
      extendedDescription:
      'Note that we use the `===` exemplar for `actual` here.  This is necessary because it is '+
      'the simplest way to represent `actual.output === undefined`.  Even if we set the `output` '+
      'facet to `===`, since the base value for the ref type is `null` as of rttc@9.3.0, that '+
      'wouldn\'t work either.',
      example: {
        message: 'Expected outcome was "success" but actually the machine triggered its "error" exit.',
        wrongOutcome: false,
        wrongOutput: false,
        tookTooLong: false,
        failedPostConditions: [{
          index: 0,
          label: 'should result in a dictionary of some kind',
          error: '==='
        }],
        actual: '===',
        // {
        //   outcome: 'success',
        //   output: '===?' (but also could be `undefined`),
        //   inspectedOutput: '{ stuff: "things" }',
        //   duration: 2948
        // }
      }
    },

    success: {
      description: 'The test was successful.',
      outputFriendlyName: 'What actually happened',
      outputDescription: 'A dictionary reporting the actual outcome, output, duration, etc.',
      extendedDescription:
      'Note that we use the `===` exemplar here.  This is necessary because it is the simplest '+
      'way to represent `output: undefined`.  Even if we set the `output` facet to `===`, since '+
      'the base value for the ref type is `null` as of rttc@9.3.0, that wouldn\'t work either.',
      example: '===',
      // {
      //   outcome: 'success',
      //   output: '===?' (but also could be `undefined`),
      //   inspectedOutput: '{ stuff: "things" }',
      //   duration: 2948
      // }
    }

  },

  fn: function (inputs, exits) {

    /**
     * Module depenencies
     */

    var util = require('util');
    var _ = require('lodash');
    var async = require('async');
    var Machines = require('machinepack-machines');
    var rttc = require('rttc');
    var JsonDiffer = require('json-diff');


    if (_.isArray(inputs.using) || !_.isObject(inputs.using)) {
      return exits.error('Invalid input value for `using`.  Should be a dictionary of input values.');
    }

    var machineInstance = inputs.machineInstance;

    // Deserialize `inputs.using` (the input values to feed in to the machine)
    var inputValues;
    try {
      inputValues = _.reduce(inputs.using, function (memo, inputVal, inputName){
        // Handle case where a value was provided for an unknown input
        var inputDef = machineInstance.inputs[inputName];
        if (!inputDef) {
          throw new Error('Test specifies a value for an input which does not actually exist in the machine definition (`'+inputName+'`).');
        }
        // Hydrate input value (i.e. make the functions juicy)
        var valToUse;
        try {
          valToUse = rttc.hydrate(inputVal, rttc.infer(inputDef.example));
        }
        catch (e) {
          // TODO: backwards compatibility..?
          throw e;
        }

        // If configured input value is a string, but the machine is expecting
        // a JSON value, then attempt to parse.
        var typeSchema = rttc.infer(inputDef.example);
        var isExpectingJson = (typeSchema !== 'string' && typeSchema !== 'number' && typeSchema !== 'boolean' && typeSchema !== 'lamda');
        if (_.isString(valToUse) && isExpectingJson) {
          try {
            valToUse = JSON.parse(valToUse);
          }
          catch (e) {
            // If parsing fails, then just pass the string straight through.
          }
        }

        // Skip undefined input values.
        if (_.isUndefined(valToUse)) {
          return memo;
        }

        memo.push({
          name: inputName,
          value: valToUse
        });

        return memo;
      }, []);
    }
    catch (e) {
      return exits.error(e);
    }

    // console.log('USING:',inputs.using);
    // console.log('INPUT VALUES:',inputValues);
    // console.log('\n\n');


    // Use `runInstantiatedMachine` from machinepack-machines in here
    // to avoid unnecessary duplication of code.
    Machines.runInstantiatedMachine({
      machineInstance: machineInstance,
      inputValues: inputValues
    }).exec({
      error: function (err){
        return exits.error(err);
      },
      cantStringifyOutput: function (whatActuallyHappened) {
        return exits.cantStringifyOutput(_.extend({
          message: util.format('Output returned by `%s` machine\'s "%s" exit could not be stringified as JSON:\n',machineInstance.identity, whatActuallyHappened.outcome,whatActuallyHappened.inspectedOutput),
        }, whatActuallyHappened));
      },
      success: function (whatActuallyHappened){

        // If expected output is specified, but expected *outcome* isn't, assume
        // the test is referring to the success exit.
        var outputAssertion = inputs.expectedOutput;
        if (!_.isUndefined(outputAssertion) && !_.isString(inputs.expectedOutcome)) {
          inputs.expectedOutcome = 'success';
        }

        // Validate against the provided assertions and build a failure report object.
        var failureReport = {

          // This message is extended below.
          message: util.format('Expectations failed for `%s` machine. ', machineInstance.identity),

          // Metadata indicating status of the run.
          wrongOutcome: false,
          wrongOutput: false,
          tookTooLong: false,
          failedPostConditions: [],

          // Also include actual result stats from the run.
          actual: {
            output: whatActuallyHappened.output,
            inspectedOutput: whatActuallyHappened.inspectedOutput,
            outcome: whatActuallyHappened.outcome,
            duration: whatActuallyHappened.duration
          }
        };


        // If specified, test `outcome` assertion (which exit was traversed)
        if (_.isString(inputs.expectedOutcome)) {
          failureReport.wrongOutcome = (inputs.expectedOutcome !== whatActuallyHappened.outcome);
        }

        // If specified, test JSON-encoded `output` assertion (output value returned from exit)
        if (!_.isUndefined(outputAssertion)) {

          // Now compare actual vs. expected output
          try {
            // Look up the exit definition for the expected outcome
            var exitDef = machineInstance.exits[whatActuallyHappened.outcome];
            // and use it to infer the expected `typeSchema` in order to do a
            // better comparison with isEqual().
            if (_.isUndefined(exitDef.example)) {
              failureReport.wrongOutput = !rttc.isEqual(outputAssertion, whatActuallyHappened.output);
            }
            else {
              var typeSchema = rttc.infer(exitDef.example);
              failureReport.wrongOutput = !rttc.isEqual(outputAssertion, whatActuallyHappened.output, typeSchema);
            }
          }
          catch (e){
            var _testFailedErr = new Error(util.format('Could not compare result with expected value using rttc.isEqual(), because an Error was encountered:'+e.stack));
            _.extend(_testFailedErr, {
              actual: whatActuallyHappened
            });
            return exits.error(_testFailedErr);
          }
        }


        // Check `maxDuration`
        if (!_.isUndefined(inputs.maxDuration)) {
          if (whatActuallyHappened.duration > inputs.maxDuration) {
            failureReport.tookTooLong = true;
          }
        }

        // Validate postconditions
        async.eachSeries(_.range(inputs.postConditions.length), function (i, next){

          // Run post-condition function
          // console.log('about to test post condition #'+i+' :: ', util.inspect(inputs.postConditions[i], false, null));
          try {
            // TODO: provide some kind of configurable timeout for post-condition functions
            inputs.postConditions[i].fn(whatActuallyHappened.output, function (err) {
              // If it provided a truthy `err`, then this is a failure-
              // so track the array index.
              if (err) {
                var actualOutputMsg = '\n\n';
                if (_.isError(whatActuallyHappened.output)) {
                  actualOutputMsg +='Actual output was an error:\n'+whatActuallyHappened.output.stack;
                }
                else {
                  actualOutputMsg = 'Actual output:\n'+util.inspect(whatActuallyHappened.output, false, null);
                }
                if (_.isError(err)) {
                  err.message += actualOutputMsg;
                  err.stack += actualOutputMsg;
                }
                else if (_.isString(err)) {
                  err += actualOutputMsg;
                  err = new Error(err);
                }
                else {
                  err = new Error('Post-condition test failed- returned error data:\n'+util.inspect(err, false, null)+actualOutputMsg);
                }

                failureReport.failedPostConditions.push({
                  index: i,
                  label: inputs.postConditions[i].label,
                  error: err
                });
              }
              return next();
            });
          }
          catch (e) {
            var err = e;
            var actualOutputMsg = '\n\n';
            if (_.isError(whatActuallyHappened.output)) {
              actualOutputMsg +='Actual output was an error:\n'+whatActuallyHappened.output.stack;
            }
            else {
              actualOutputMsg = 'Actual output:\n'+util.inspect(whatActuallyHappened.output, false, null);
            }
            if (_.isError(err)) {
              err.message += actualOutputMsg;
              err.stack += actualOutputMsg;
            }
            else if (_.isString(err)) {
              err += actualOutputMsg;
              err = new Error(err);
            }
            else {
              err = new Error('Post-condition test failed- returned error data:\n'+util.inspect(err, false, null)+actualOutputMsg);
            }
            failureReport.failedPostConditions.push({
              index: i,
              label: inputs.postConditions[i].label,
              error: err
            });
            return next();
          }

        }, function (err) {
          if (err) {
            return exits.error(err);
          }

          // Determine whether the test passed overall or not.
          var didTestPass =
          !failureReport.wrongOutcome &&
          !failureReport.wrongOutput &&
          !failureReport.tookTooLong &&
          (failureReport.failedPostConditions.length === 0);

          // If the test passed, report back to test engine and bail out.
          if (didTestPass) {
            return exits.success(whatActuallyHappened);
          }


          // Otherwise, if we're here, that means the test failed.
          // Report back to test engine w/ a detailed failure report..

          // Enhance result msg using outcome and inspectedOutput.
          if (failureReport.wrongOutcome) {
            failureReport.message += util.format('  Expected outcome "%s" but actually the machine triggered its "%s" exit', inputs.expectedOutcome, whatActuallyHappened.outcome);
            if (!_.isUndefined(whatActuallyHappened.output)) {
              failureReport.message += util.format(' and returned a %s:\n %s', rttc.getDisplayType(whatActuallyHappened.output), whatActuallyHappened.inspectedOutput);
            }
            else {
              failureReport.message += '.';
            }
          }

          // Enhance result msg using expected `output` and actual output.
          if (failureReport.wrongOutput) {
            // Showing full expected output AND actual output can get really overwhelming sometimes.
            // So we check how big this stuff is before showing that.
            //
            // If the expected output AND actual output are both objects of some kind (could be arrays
            // too) then try to compute the JSON diff and use that.
            var diffStr;
            if (!_.isObject(failureReport.actual.output) || !_.isObject(outputAssertion)){
              try {
                diffStr = JsonDiffer.diffString([{x:2, y:3}], {y: 3, x:4});
              } catch (e) { /*ignore errors here */ }
            }
            if (diffStr) {
              failureReport.message += util.format(
              '  Expected output was a %s -- but actually the machine returned a %s. (diff below)\n'+
              '  Diff:', rttc.getDisplayType(outputAssertion), rttc.getDisplayType(failureReport.actual.output), diffStr);
            }
            // If that doesn't work, or if either the expected or actual output is a non-object,
            // then just show the normal expected vs. actual message:
            else {
              failureReport.message += util.format('  Expected output was: `%s` (a %s) -- but actually the machine returned: `%s` (a %s)', util.inspect(outputAssertion, false, null), rttc.getDisplayType(outputAssertion), util.inspect(whatActuallyHappened.output, false, null), rttc.getDisplayType(failureReport.actual.output));
            }

          }

          if (failureReport.tookTooLong) {
            failureReport.message += util.format('  Machine execution took longer than expected- should have finished in %d miliseconds, but actually took %d.', inputs.maxDuration, whatActuallyHappened.duration);
          }

          if (failureReport.failedPostConditions.length > 0) {
            failureReport.message += util.format('  The provided post-condition function failed.');
          }

          // console.log('FAILURE REPORT:',failureReport);

          return exits.failed(failureReport);
        }); //</async.eachSeries>

      } // </runMachine.success>
    }); // </runMachine()>
  }


});
