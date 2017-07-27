/**
 * Module depenencies
 */

var util = require('util');
var _ = require('@sailshq/lodash');
var async = require('async');
var JsonDiffer = require('json-diff');
var Machines = require('machinepack-machines');
var rttc = require('rttc');
var chalk = require('chalk');


module.exports = function (Pack, testSuite, eachTest, done){

  var identity = testSuite.machine;

  var machine = _.find(Pack, function (wetMachine){
    if (wetMachine.getDef) {
      return wetMachine.getDef().identity === identity;
    }
    else if (wetMachine.identity) {
      return wetMachine.identity === identity;
    }
    else {
      throw new Error('Invalid machine:\n\n--\n'+util.inspect(wetMachine)+'\n--\n^^It has neither a `getDef()` method nor an `identity`!');
    }
  });

  if (!_.isFunction(machine)) {
    throw new Error('Unrecognized machine: `'+testSuite.machine+'` in pack: '+util.inspect(Pack));
  }

  // Handle machine runner >= v15.0.0
  var machineDef;
  if (!machine.inputs && machine.getDef()) {
    machineDef = machine.getDef();
  }
  else {
    machineDef = machine;
  }

  var i = 0;
  async.map(testSuite.expectations, function eachTestCase(testCase, next_testCase){
    i++;

    // If marked as `todo`, defer this test
    if (testCase.todo){
      eachTest(testCase, function (informTestFinished){
        if (_.isFunction(informTestFinished)){
          informTestFinished();
        }
        return next_testCase();
      });
      return;
    }

    eachTest(testCase, function actuallyRunAndTestMachine(informTestFinished){

      // Deserialize `testCase.using` (the input values to feed in to the machine)
      var inputValues;
      try {
        inputValues = _.reduce(testCase.using, function (memo, inputVal, inputName){
          // Handle case where a value was provided for an unknown input
          var inputDef = machineDef.inputs[inputName];
          if (!inputDef) {
            throw new Error('Test specifies a value for an input which does not actually exist in the machine definition (`'+inputName+'`).');
          }

          // Infer the type schema for the input
          var typeSchema = rttc.infer(inputDef.example);

          // Hydrate input value (i.e. make the functions juicy)
          var valToUse;
          try {
            valToUse = rttc.hydrate(inputVal, typeSchema);
          }
          catch (e) {
            // TODO: backwards compatibility..?
            throw e;
          }

          // If configured input value is a string, but the machine is expecting
          // a JSON value, dictionary, or array, then attempt to parse.
          var isExpectingJson = (typeSchema !== 'string' && typeSchema !== 'number' && typeSchema !== 'boolean' && typeSchema !== 'lamda');
          if (_.isString(valToUse) && isExpectingJson) {
            try {
              valToUse = JSON.parse(valToUse);
            }
            catch (e) {
              // If parsing fails, then just pass the string straight through.
            }
          }

          memo.push({
            name: inputName,
            value: valToUse
          });

          return memo;
        }, []);
      }
      catch (e) {
        // Trigger `informTestFinished` function if it was provided
        if (_.isFunction(informTestFinished)){
          informTestFinished(e);
        }
        // Continue to next test
        return next_testCase();
      }

      // Now test the machine.
      Machines.runInstantiatedMachine({
        machineInstance: machine,
        inputValues: inputValues
      }).exec({
        error: function (err){
          // Trigger `informTestFinished` function if it was provided
          if (_.isFunction(informTestFinished)){
            informTestFinished(err);
          }
          // Then either way, ignore the error and continue on to the next test case.
          return next_testCase();
        },
        cantStringifyOutput: function (whatActuallyHappened) {
          // Report back to test engine w/ an error
          var errMsg = util.format('Failed test #%s for machine `%s`.', i, testSuite.machine);
          errMsg += util.format('Output returned by machine\'s "%s" exit could not be stringified as JSON:\n',whatActuallyHappened.outcome,whatActuallyHappened.inspectedOutput);
          var _testFailedErr = new Error(errMsg);
          _.extend(_testFailedErr, testCase);
          _testFailedErr.actual = whatActuallyHappened;

          // Trigger `informTestFinished` function if it was provided
          if (_.isFunction(informTestFinished)){
            informTestFinished(_testFailedErr);
          }
          // Then either way, ignore the error and continue on to the next test case.
          return next_testCase();
        },
        success: function (whatActuallyHappened){

          // (backwards compatibility for `returns` assertion)
          var outputAssertion = !_.isUndefined(testCase.output) ? testCase.output : testCase.returns;
          // If expected output is specified, but expected *outcome* isn't, assume
          // the test is referring to the success exit.
          if (!_.isUndefined(outputAssertion) && !_.isString(testCase.outcome)) {
            testCase.outcome = 'success';
          }

          // Look up the exit definition for the expected outcome
          var exitDef = machineDef.exits[testCase.outcome];
          if (!exitDef) {
            throw new Error('Consistency violation: The exit (`'+testCase.outcome+'`) that this test expects to be triggered is not actually defined in this machine (`'+testSuite.machine+'`)');
          }
          // and use it to infer the expected `typeSchema` in order to do a better comparison
          // between pieces, and for use in decoding the expected output below.
          var typeSchema;
          try {
            typeSchema = rttc.infer(exitDef.example);

            // If it's present, now hydrate the `outputAssertion` for this test
            // (the expected return value) in case it contains any stringified lamda functios
            if (!_.isUndefined(outputAssertion)) {
              outputAssertion = rttc.dehydrate(outputAssertion, typeSchema);

              // If output assertion is a string, but the machine is expecting JSON
              // then attempt to parse the output assertion before performing the check.
              var isExpectingJson = (typeSchema !== 'string' && typeSchema !== 'number' && typeSchema !== 'boolean' && typeSchema !== 'lamda');
              if (_.isString(outputAssertion) && isExpectingJson) {
                try {
                  outputAssertion = JSON.parse(outputAssertion);
                }
                catch (e) {
                  // If parsing fails, then just pass the original output assertion
                  // straight through.
                }
              }
              // console.log('-->',whatActuallyHappened.output, '('+typeof whatActuallyHappened.output+')');
              // console.log('==> should be:',outputAssertion, '('+typeof outputAssertion+')');
            }
          }
          catch (e) {
            // TODO: backwards compatibility..?
            throw e;
          }


          // Build test result object
          var testResultObj = {

            wrongOutcome: false,

            wrongOutput: false,

            // TODO: support `maxDuration` assertion
            // (but this should be accomplished by just calling testMachine()-- it's already implemented there)
            tookTooLong: false,

            // We could eventually support `postConditions` here
            // (maybe relevant for json5 files that can support functions)
            // (but if we do it, this should be accomplished by just calling testMachine()-- it's already implemented there.)
            failedPostcondition: false
          };

          // If specified, test `outcome` assertion (which exit was traversed)
          if (_.isString(testCase.outcome)) {
            testResultObj.wrongOutcome = (testCase.outcome !== whatActuallyHappened.outcome);
          }

          // If specified, test JSON-encoded `output` assertion (output value returned from exit)
          if (!_.isUndefined(outputAssertion)) {

            // Now compare actual vs. expected output
            // console.log('checking using type schema:',typeSchema);
            try {
              testResultObj.wrongOutput = ! rttc.isEqual(outputAssertion, whatActuallyHappened.output, typeSchema);
            }
            catch (e){
              // console.log('* * * *',e.stack);
              errMsg += util.format('Could not compare result with expected value, because rttc.isEqual threw an Error:'+e.stack);
              var _testFailedErr = new Error(errMsg);
              _.extend(_testFailedErr, testCase);
              _testFailedErr.actual = whatActuallyHappened;

              // Trigger `informTestFinished` function if it was provided
              if (_.isFunction(informTestFinished)){
                informTestFinished(_testFailedErr);
              }
              // Then either way, ignore the error and continue on to the next test case.
              return next_testCase();
            }
          }

          // Determine whether the test passed overall or not.
          testResultObj.pass = !testResultObj.wrongOutcome && !testResultObj.wrongOutput && !testResultObj.tookTooLong && !testResultObj.failedPostcondition;

          // Save other metadata about the run
          testResultObj.actual = whatActuallyHappened;
          // (also include `returns` as an alias for `output` for backwards compatibility)
          testResultObj.actual.returns = whatActuallyHappened.output;

          // If the test passed, report back to test engine and bail out.
          if (testResultObj.pass) {

            // Trigger `informTestFinished` function if it was provided
            if (_.isFunction(informTestFinished)){
              informTestFinished();
            }
            // Continue to next test
            return next_testCase(null, testResultObj);
          }

          // Otherwise, if we're here, that means the test failed.
          // Report back to test engine w/ a detailed error.
          var errMsg = util.format('Failed test #%s for machine `%s`.',i, testSuite.machine);
          var _testFailedErr = new Error(errMsg);
          _testFailedErr.message = errMsg;
          _.extend(_testFailedErr, testCase);
          _testFailedErr.actual = testResultObj.actual;


          // Enhance result msg using outcome and inspectedOutput.
          if (testResultObj.wrongOutcome) {
            _testFailedErr.message += util.format('  Expected outcome "%s" but actually the machine triggered its "%s" exit', testCase.outcome, _testFailedErr.actual.outcome);
            if (!_.isUndefined(testResultObj.actual.output)) {
              _testFailedErr.message += util.format(' and returned a %s:\n %s', _.isArray(_testFailedErr.actual.output)?'array':typeof _testFailedErr.actual.output, _testFailedErr.actual.inspectedOutput);
            }
            else {
              _testFailedErr.message += '.';
            }
          }

          // Enhance result msg using expected `output` and actual output.
          if (testResultObj.wrongOutput) {

            // Showing full expected output AND actual output can get really overwhelming sometimes.
            // So we check how big this stuff is before showing that.
            //
            // If the expected output AND actual output are both objects of some kind (could be arrays
            // too) then try to compute the JSON diff and use that.
            var diffStr;
            if (_.isObject(testResultObj.actual.output) && _.isObject(outputAssertion)){
              try {
                diffStr = JsonDiffer.diffString(testResultObj.actual.output, outputAssertion);
              } catch (e) { /*ignore errors here-- we just use the more basic output if that happens */ }
            }
            if (diffStr) {
              _testFailedErr.message += util.format(
              '  Expected output was a %s -- but actually the machine returned a %s. (diff below...)\n'+
              chalk.reset('  Diff:'), rttc.getDisplayType(outputAssertion), rttc.getDisplayType(testResultObj.actual.output), diffStr);
            }
            // If that doesn't work, or if either the expected or actual output is a non-object,
            // then just show the normal expected vs. actual message:
            else {
              _testFailedErr.message += util.format('  Expected output was: `%s` (a %s) -- but actually the machine returned: `%s` (a %s)', util.inspect(outputAssertion, false, null), rttc.getDisplayType(outputAssertion), util.inspect(whatActuallyHappened.output, false, null), rttc.getDisplayType(testResultObj.actual.output));
            }

          }

          // Trigger `informTestFinished` function if it was provided
          if (_.isFunction(informTestFinished)){
            informTestFinished(_testFailedErr);
          }

          // Continue to next test
          return next_testCase(null, testResultObj);

        } // </runMachine.success>
      }); // </runMachine()>
    }); // </eachTest()>
  }, function afterAsyncMap (err, results) {
    if (!_.isFunction(done)) {
      return;
    }
    if (err) {
      return done(err);
    }
    return done(null, results);
  });
};
