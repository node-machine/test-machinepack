/**
 * Module depenencies
 */

var util = require('util');
var _ = require('lodash');
var async = require('async');
var Machines = require('machinepack-machines');
var rttc = require('rttc');


module.exports = function (Pack, testSuite, eachTest, done){

  var machine = _.find(Pack, {identity: testSuite.machine});
  if (!machine) {
    throw new Error(util.format('Unrecognized machine: `%s`', testSuite.machine));
  }


  async.map(testSuite.expectations, function eachTestCase(testCase, next_testCase){

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
          var inputDef = machine.inputs[inputName];
          if (!inputDef) {
            throw new Error('Test specifies a value for an input which does not actually exist in the machine definition (`'+inputName+'`).');
          }
          // Decode expected input value from its encoded format in our test file
          var valToUse;
          try {
            valToUse = rttc.decode(inputVal, rttc.infer(inputDef.example), true);
          }
          catch (e) {
            // For backwards compatibility, also tolerate values that aren't JSON-encoded.
            valToUse = inputVal;
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


      // Use `runMachine` from machinepack-machines in here instead to avoid
      // unnecessary duplication of code
      Machines.runMachine({
        machinepackPath: Pack._meta.path,
        identity: testSuite.machine,
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
          var errMsg = util.format('Failed test #%s for machine `%s`.', '?',testSuite.machine);
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
          var exitDef = machine.exits[testCase.outcome];
          // and use it to infer the expected `typeSchema` in order to do a better comparison
          // between pieces, and for use in decoding the expected output below.
          var typeSchema;
          try {
            typeSchema = rttc.infer(exitDef.example);
          }
          catch (e) {}


          // If it's present, now decode the `outputAssertion` for this test
          // (the expected return value)
          if (!_.isUndefined(outputAssertion)) {
            try {
              outputAssertion = rttc.decode(outputAssertion, typeSchema, true);
            }
            catch (e) {
              // For backwards compatibility, also tolerate output assertions that aren't JSON-encoded.
            }
          }

          // Build test result object
          var testResultObj = {

            wrongOutcome: false,

            wrongOutput: false,

            // TODO: support `maxDuration` assertion
            tookTooLong: false,

            // TODO: support `after` assertion (custom asynchronous function)
            failedPostcondition: false
          };

          // If specified, test `outcome` assertion (which exit was traversed)
          if (_.isString(testCase.outcome)) {
            testResultObj.wrongOutcome = (testCase.outcome !== whatActuallyHappened.outcome);
          }

          // If specified, test JSON-encoded `output` assertion (output value returned from exit)
          if (!_.isUndefined(outputAssertion)) {

            // Now compare actual vs. expected output
            try {
              testResultObj.wrongOutput = ! rttc.isEqual(outputAssertion, whatActuallyHappened.output, typeSchema);
            }
            catch (e){
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
          var errMsg = util.format('Failed test #%s for machine `%s`.', '?',testSuite.machine);
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
            _testFailedErr.message += util.format('  Expected output was: `%s` (a %s) -- but actually the machine returned: `%s` (a %s)', util.inspect(outputAssertion, false, null), rttc.getDisplayType(outputAssertion), util.inspect(_testFailedErr.actual.output, false, null), rttc.getDisplayType(_testFailedErr.actual.output));
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
