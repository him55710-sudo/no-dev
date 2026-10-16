import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.runner.JUnitCore;

/** Reports upstream JUnit results without using the JSON library under test. */
public final class PureobomJUnitRunner {
  public static void main(String[] args) throws Exception {
    Class<?>[] classes = new Class<?>[args.length];
    for (int i = 0; i < args.length; i++) classes[i] = Class.forName(args[i]);
    org.junit.runner.Result result = JUnitCore.runClasses(classes);
    for (org.junit.runner.notification.Failure failure : result.getFailures()) {
      System.out.println("PUREOBOM_FAILURE " + Base64.getEncoder().encodeToString(
          (failure.getDescription() + "\n" + failure.getTrace()).getBytes(StandardCharsets.UTF_8)));
    }
    System.out.printf("PUREOBOM_RESULT %d %d %d %d%n", result.getRunCount(),
        result.getFailureCount(), result.getIgnoreCount(), result.getRunTime());
    System.exit(result.wasSuccessful() ? 0 : 1);
  }
}
