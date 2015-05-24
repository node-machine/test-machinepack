/**
 * Module depenencies
 */

var util = require('util');
var _ = require('lodash');
var async = require('async');
var Machines = require('machinepack-machines');


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

      // Use `runMachine` from machinepack-machines in here instead to avoid
      // unnecessary duplication of code
      Machines.runMachine({
        machinepackPath: Pack._meta.path,
        identity: testSuite.machine,
        inputValues: _.reduce(testCase.using, function (memo, inputVal, inputName){
          memo.push({
            name: inputName,
            value: inputVal
          });
          return memo;
        }, [])
      }).exec({
        error: function (err){
          // Trigger `informTestFinished` function if it was provided
          if (_.isFunction(informTestFinished)){
            informTestFinished(err);
          }
          // Then either way, ignore the error and continue on to the next test case.
          return next_testCase();
        },
        success: function (whatActuallyHappened){

          // {
          //   exit: 'success',
          //   jsonValue: '{"stuff": "things"}',
          //   inspectedValue: '{ stuff: "things" }',
          //   duration: 3252,
          //   void: false
          // }

          // Build test result object
          var testResultObj = {
            pass: (function _determineIfTestCasePassed(){
              var _passed = true;

              if (_.isString(testCase.outcome)) {
                _passed = _passed && (testCase.outcome === whatActuallyHappened.exit);
              }

              // TODO: support other assertions

              return _passed;
            })(),
          };

          // Save other metadata about the run
          testResultObj.actual = {
            result: whatActuallyHappened.jsonValue,
            outcome: whatActuallyHappened.exit,
            duration: whatActuallyHappened.duration
          };

          // Report back to test engine w/ a success
          if (testResultObj.pass) {

            // Trigger `informTestFinished` function if it was provided
            if (_.isFunction(informTestFinished)){
              informTestFinished();
            }
            // Continue to next test
            return next_testCase(null, testResultObj);
          }

          // Report back to test engine w/ an error
          var _testFailedErr = new Error();
          _testFailedErr.message = '';
          _testFailedErr.message = util.format('Failed test #%s for machine `%s`.', '?',testSuite.machine);
          _.extend(_testFailedErr, testCase);
          _testFailedErr.actual = testResultObj.actual;

          // Generate pretty-printed version of result
          if (!_.isUndefined(_testFailedErr.actual.result)) {
            _testFailedErr.actual.prettyPrintedResult = (function (){
              var _prettyPrintedResult = testResultObj.actual.result;
              if (_.isObject(_prettyPrintedResult) && _prettyPrintedResult instanceof Error) {
                _prettyPrintedResult = _prettyPrintedResult.stack;
              }
              else {
                _prettyPrintedResult = util.inspect(testResultObj.actual.result);
              }
              return _prettyPrintedResult;
            })();
          }

          // Enhance result msg using outcome and prettyPrintedResult.
          if (_.isString(testCase.outcome)) {
            _testFailedErr.message += util.format('Expected outcome "%s" but actually the machine triggered its "%s" exit', testCase.outcome, _testFailedErr.actual.outcome);
            if (!_.isUndefined(testResultObj.actual.result)) {
              _testFailedErr.message += util.format(' with a %s:\n %s', _.isArray(_testFailedErr.actual.result)?'array':typeof _testFailedErr.actual.result, _testFailedErr.actual.prettyPrintedResult);
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
    if (err) {
      if (_.isFunction(done)) {
        return done(err);
      }
    }
    if (_.isFunction(done)) {
      return done(null, results);
    }
  });
};
