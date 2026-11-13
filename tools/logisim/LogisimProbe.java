// LogisimProbe - asks Logisim-evolution itself where every port of every
// component is, so the circuit generator never has to guess pin geometry.
//
//   java -cp logisim.jar:. LogisimProbe attrs "<Library>" "<Tool name>"   -> attribute names + defaults
//   java -cp logisim.jar:. LogisimProbe ports file.circ                   -> one line per port
//
// ports output: circuit<TAB>componentIndex<TAB>factory<TAB>label<TAB>x<TAB>y<TAB>portIndex<TAB>px<TAB>py<TAB>width<TAB>dir<TAB>tooltip<TAB>bounds
import com.cburch.logisim.circuit.Circuit;
import com.cburch.logisim.comp.Component;
import com.cburch.logisim.comp.EndData;
import com.cburch.logisim.data.Attribute;
import com.cburch.logisim.data.AttributeSet;
import com.cburch.logisim.data.Bounds;
import com.cburch.logisim.file.Loader;
import com.cburch.logisim.file.LogisimFile;
import com.cburch.logisim.instance.InstanceComponent;
import com.cburch.logisim.instance.Port;
import com.cburch.logisim.instance.StdAttr;
import com.cburch.logisim.proj.Project;
import com.cburch.logisim.proj.ProjectActions;
import com.cburch.logisim.tools.AddTool;
import com.cburch.logisim.tools.Library;
import com.cburch.logisim.tools.Tool;
import java.io.File;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public class LogisimProbe {
  public static void main(String[] args) throws Exception {
    System.setProperty("java.awt.headless", "true");
    com.cburch.logisim.Main.headless = true;
    if (args[0].equals("attrs")) attrs(args[1], args[2]);
    else if (args[0].equals("render")) render(args[1], args[2], args[3], Double.parseDouble(args.length > 4 ? args[4] : "1.5"));
    else ports(args[1]);
    System.exit(0);
  }

  @SuppressWarnings({"unchecked", "rawtypes"})
  static void attrs(String lib, String tool) throws Exception {
    File tmp = File.createTempFile("probe", ".circ");
    java.nio.file.Files.writeString(tmp.toPath(), "<?xml version=\"1.0\" encoding=\"UTF-8\"?><project version=\"1.0\">"
        + "<lib name=\"0\" desc=\"#Wiring\"/><lib name=\"1\" desc=\"#Gates\"/><lib name=\"2\" desc=\"#Plexers\"/>"
        + "<lib name=\"3\" desc=\"#Arithmetic\"/><lib name=\"4\" desc=\"#Memory\"/><lib name=\"5\" desc=\"#I/O\"/><lib name=\"8\" desc=\"#Base\"/>"
        + "<main name=\"main\"/><circuit name=\"main\"/></project>");
    LogisimFile f = ProjectActions.doOpenNoWindow(null, tmp).getLogisimFile();
    if (lib.equals("list")) {
      for (Library l : f.getLibraries()) {
        StringBuilder sb = new StringBuilder(l.getName() + " | " + l.getDisplayName() + ":");
        for (Tool t : l.getTools()) sb.append(" [").append(t.getName()).append("]");
        System.out.println(sb);
      }
      return;
    }
    for (Library l : f.getLibraries()) {
      for (Tool t : l.getTools()) {
        if (!(t instanceof AddTool)) continue;
        if (!l.getDisplayName().equalsIgnoreCase(lib) && !l.getName().equalsIgnoreCase(lib)) continue;
        if (!t.getName().equalsIgnoreCase(tool)) continue;
        AttributeSet as = ((AddTool) t).getFactory().createAttributeSet();
        System.out.println("library " + l.getName() + " / " + l.getDisplayName() + "  tool " + t.getName());
        for (Attribute a : as.getAttributes()) {
          Object v = as.getValue(a);
          String s;
          try { s = v == null ? "null" : a.toStandardString(v); } catch (Exception e) { s = String.valueOf(v); }
          if (s.length() > 60) s = s.substring(0, 60) + "...";
          System.out.println("  " + a.getName() + " = " + s);
        }
      }
    }
  }

  // Draw one circuit to a PNG using Logisim's own painting code (white background, no simulation values).
  static void render(String path, String circuitName, String out, double scale) throws Exception {
    Project p = ProjectActions.doOpenNoWindow(null, new File(path));
    Circuit c = p.getLogisimFile().getCircuit(circuitName);
    java.awt.image.BufferedImage tmp = new java.awt.image.BufferedImage(10, 10, java.awt.image.BufferedImage.TYPE_INT_RGB);
    Bounds b = c.getBounds(tmp.getGraphics()).expand(30);
    int w = (int) Math.ceil(b.getWidth() * scale), h = (int) Math.ceil(b.getHeight() * scale);
    java.awt.image.BufferedImage img = new java.awt.image.BufferedImage(w, h, java.awt.image.BufferedImage.TYPE_INT_RGB);
    java.awt.Graphics2D g = img.createGraphics();
    g.setRenderingHint(java.awt.RenderingHints.KEY_ANTIALIASING, java.awt.RenderingHints.VALUE_ANTIALIAS_ON);
    g.setRenderingHint(java.awt.RenderingHints.KEY_TEXT_ANTIALIASING, java.awt.RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
    g.setColor(java.awt.Color.WHITE);
    g.fillRect(0, 0, w, h);
    g.scale(scale, scale);
    g.translate(-b.getX(), -b.getY());
    com.cburch.logisim.circuit.CircuitState st = p.getCircuitState(c);
    com.cburch.logisim.comp.ComponentDrawContext ctx = new com.cburch.logisim.comp.ComponentDrawContext(null, c, st, g, g, false);
    ctx.setShowState(false);
    c.draw(ctx, java.util.Collections.emptySet());
    g.dispose();
    javax.imageio.ImageIO.write(img, "png", new File(out));
    System.out.println("rendered " + circuitName + " " + w + "x" + h + " -> " + out);
  }

  static void ports(String path) throws Exception {
    Project p = ProjectActions.doOpenNoWindow(null, new File(path));
    for (Circuit c : p.getLogisimFile().getCircuits()) {
      List<Component> comps = new ArrayList<>(c.getNonWires());
      comps.sort(Comparator.comparingInt((Component x) -> x.getLocation().getX()).thenComparingInt(x -> x.getLocation().getY()));
      int idx = 0;
      for (Component comp : comps) {
        String label = "";
        try { Object v = comp.getAttributeSet().getValue(StdAttr.LABEL); if (v != null) label = v.toString(); } catch (Exception e) { }
        Bounds b = comp.getBounds();
        String bs = b.getX() + "," + b.getY() + "," + b.getWidth() + "," + b.getHeight();
        List<EndData> ends = comp.getEnds();
        List<Port> ports = comp instanceof InstanceComponent ? ((InstanceComponent) comp).getInstance().getPorts() : null;
        for (int i = 0; i < ends.size(); i++) {
          EndData e = ends.get(i);
          String tip = "";
          if (ports != null && i < ports.size() && ports.get(i).getToolTip() != null) tip = ports.get(i).getToolTip();
          String dir = e.isInput() && e.isOutput() ? "io" : e.isInput() ? "in" : "out";
          System.out.println(String.join("\t", c.getName(), String.valueOf(idx), comp.getFactory().getName(), label,
              String.valueOf(comp.getLocation().getX()), String.valueOf(comp.getLocation().getY()), String.valueOf(i),
              String.valueOf(e.getLocation().getX()), String.valueOf(e.getLocation().getY()),
              String.valueOf(e.getWidth().getWidth()), dir, tip.replace('\t', ' ').replace('\n', ' '), bs));
        }
        idx++;
      }
    }
  }
}
